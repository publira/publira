package webpushsettings

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"testing"
	"time"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/push"
	"github.com/publira/publira/server/internal/secretcrypto"
)

func testEncryptor(t *testing.T) *secretcrypto.Manager {
	t.Helper()
	manager, err := secretcrypto.NewManager(map[string][]byte{"k1": make([]byte, 32)}, "k1")
	if err != nil {
		t.Fatalf("secretcrypto.NewManager: %v", err)
	}
	return manager
}

// fakeStore is the one row the table can hold. racer, when set, is stored by
// the first insert in place of the pair it was given, which is what losing
// the race to another process looks like from here.
type fakeStore struct {
	row      *dbmodels.PlatformWebpushConfig
	racer    *dbmodels.InsertPlatformWebPushKeyPairParams
	inserts  int
	readErr  error
	reads    int
	keyReads int
}

func (f *fakeStore) GetPlatformWebPushConfig(context.Context) (dbmodels.PlatformWebpushConfig, error) {
	f.reads++
	if f.readErr != nil {
		return dbmodels.PlatformWebpushConfig{}, f.readErr
	}
	if f.row == nil {
		return dbmodels.PlatformWebpushConfig{}, sql.ErrNoRows
	}
	return *f.row, nil
}

func (f *fakeStore) InsertPlatformWebPushKeyPair(_ context.Context, arg dbmodels.InsertPlatformWebPushKeyPairParams) (int64, error) {
	f.inserts++
	if f.racer != nil {
		arg, f.racer = *f.racer, nil
		f.row = &dbmodels.PlatformWebpushConfig{Singleton: true, VapidPublicKey: arg.VapidPublicKey, VapidPrivateKeyEncrypted: arg.VapidPrivateKeyEncrypted, Revision: 1}
		return 0, nil
	}
	if f.row != nil {
		return 0, nil
	}
	f.row = &dbmodels.PlatformWebpushConfig{Singleton: true, VapidPublicKey: arg.VapidPublicKey, VapidPrivateKeyEncrypted: arg.VapidPrivateKeyEncrypted, Revision: 1}
	return 1, nil
}

func (f *fakeStore) GetPublishedWebPushPublicKey(context.Context) (string, error) {
	f.keyReads++
	if f.readErr != nil {
		return "", f.readErr
	}
	if f.row == nil || !f.row.Subject.Valid {
		return "", sql.ErrNoRows
	}
	return f.row.VapidPublicKey, nil
}

func (f *fakeStore) saveSubject(subject string) {
	f.row.Subject = sql.NullString{String: subject, Valid: true}
	f.row.Revision++
}

func TestValidateSubject(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		subject string
		valid   bool
	}{
		{subject: "mailto:push@example.com", valid: true},
		{subject: "https://example.com/contact", valid: true},
		{subject: "https://example.com", valid: true},
		{subject: ""},
		{subject: "push@example.com"},
		{subject: "mailto:"},
		{subject: "mailto:not-an-address"},
		{subject: "mailto:Push <push@example.com>"},
		{subject: "http://example.com"},
		{subject: "https://"},
		{subject: "https://user:pass@example.com"},
		{subject: "https:example.com"},
		{subject: "mailto:" + strings.Repeat("a", maxSubjectLength) + "@example.com"},
	} {
		t.Run(tc.subject, func(t *testing.T) {
			t.Parallel()
			err := ValidateSubject(tc.subject)
			if tc.valid && err != nil {
				t.Fatalf("ValidateSubject(%q) = %v, want nil", tc.subject, err)
			}
			if !tc.valid && !errors.Is(err, ErrInvalidSubject) {
				t.Fatalf("ValidateSubject(%q) = %v, want ErrInvalidSubject", tc.subject, err)
			}
		})
	}
}

func TestCredentialsFormatRedacted(t *testing.T) {
	t.Parallel()

	credentials := Credentials{PublicKey: "public", PrivateKey: "the-private-key", Subject: "mailto:push@example.com"}
	for _, formatted := range []string{
		fmt.Sprintf("%v", credentials),
		fmt.Sprintf("%+v", credentials),
		fmt.Sprintf("%#v", credentials),
		credentials.LogValue().String(),
	} {
		if strings.Contains(formatted, "the-private-key") {
			t.Fatalf("formatted credentials = %q, want the private key left out", formatted)
		}
	}
}

// A fresh installation has no pair, and the first read makes one: a public key
// a browser accepts and a private key that is sealed rather than stored as is.
func TestEnsureGeneratesAndSealsAKeyPair(t *testing.T) {
	t.Parallel()

	store := &fakeStore{}
	encryptor := testEncryptor(t)

	config, err := Ensure(context.Background(), store, encryptor)
	if err != nil {
		t.Fatalf("Ensure: %v", err)
	}
	if !secretcrypto.IsEncryptedEnvelope(config.VapidPrivateKeyEncrypted) {
		t.Fatalf("stored private key = %q, want an encrypted envelope", config.VapidPrivateKeyEncrypted)
	}
	if config.Subject.Valid {
		t.Fatalf("subject = %q, want none until an operator saves one", config.Subject.String)
	}
	privateKey, err := encryptor.DecryptString(config.VapidPrivateKeyEncrypted)
	if err != nil {
		t.Fatalf("DecryptString: %v", err)
	}
	if err := push.ValidateWebPushConfig(push.WebPushConfig{
		VAPIDPublicKey:  config.VapidPublicKey,
		VAPIDPrivateKey: privateKey,
		Subscriber:      "mailto:push@example.com",
	}); err != nil {
		t.Fatalf("the generated pair does not sign: %v", err)
	}
}

// The pair every subscription was made against must outlive the process that
// made it: a second read answers the stored pair and generates nothing.
func TestEnsureKeepsTheStoredPair(t *testing.T) {
	t.Parallel()

	store := &fakeStore{}
	encryptor := testEncryptor(t)

	first, err := Ensure(context.Background(), store, encryptor)
	if err != nil {
		t.Fatalf("Ensure: %v", err)
	}
	second, err := Ensure(context.Background(), store, encryptor)
	if err != nil {
		t.Fatalf("Ensure: %v", err)
	}
	if second.VapidPublicKey != first.VapidPublicKey || second.VapidPrivateKeyEncrypted != first.VapidPrivateKeyEncrypted {
		t.Fatal("the second read answered a different pair")
	}
	if store.inserts != 1 {
		t.Fatalf("inserts = %d, want 1", store.inserts)
	}
}

// Two processes that find no row both generate a pair, and the one that loses
// the race answers the winner's rather than its own.
func TestEnsureAnswersThePairThatWonTheRace(t *testing.T) {
	t.Parallel()

	store := &fakeStore{racer: &dbmodels.InsertPlatformWebPushKeyPairParams{
		VapidPublicKey:           "the-winners-public-key",
		VapidPrivateKeyEncrypted: "the-winners-sealed-private-key",
	}}

	config, err := Ensure(context.Background(), store, testEncryptor(t))
	if err != nil {
		t.Fatalf("Ensure: %v", err)
	}
	if config.VapidPublicKey != "the-winners-public-key" {
		t.Fatalf("public key = %q, want the one stored first", config.VapidPublicKey)
	}
}

func TestEnsureRefusesToStoreAPairItCannotSeal(t *testing.T) {
	t.Parallel()

	store := &fakeStore{}
	if _, err := Ensure(context.Background(), store, nil); !errors.Is(err, ErrSecretManagerUnavailable) {
		t.Fatalf("Ensure error = %v, want ErrSecretManagerUnavailable", err)
	}
	if store.inserts != 0 {
		t.Fatalf("inserts = %d, want none", store.inserts)
	}
}

func TestLoadCredentialsIsNotConfiguredUntilASubjectIsSaved(t *testing.T) {
	t.Parallel()

	store := &fakeStore{}
	encryptor := testEncryptor(t)

	if _, err := LoadCredentials(context.Background(), store, encryptor); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("LoadCredentials with no row = %v, want ErrNotConfigured", err)
	}
	if _, err := Ensure(context.Background(), store, encryptor); err != nil {
		t.Fatalf("Ensure: %v", err)
	}
	if _, err := LoadCredentials(context.Background(), store, encryptor); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("LoadCredentials with no subject = %v, want ErrNotConfigured", err)
	}
	if store.inserts != 1 {
		t.Fatalf("inserts = %d, want LoadCredentials to generate nothing", store.inserts)
	}

	store.saveSubject("mailto:push@example.com")
	credentials, err := LoadCredentials(context.Background(), store, encryptor)
	if err != nil {
		t.Fatalf("LoadCredentials: %v", err)
	}
	if credentials.Subject != "mailto:push@example.com" || credentials.PublicKey != store.row.VapidPublicKey {
		t.Fatalf("credentials = %+v, want the stored subject and public key", credentials)
	}
	if credentials.PrivateKey == store.row.VapidPrivateKeyEncrypted || credentials.PrivateKey == "" {
		t.Fatal("credentials carry the sealed private key, want it opened")
	}
}

func TestPublicKeysPublishesNothingUntilASubjectIsSaved(t *testing.T) {
	t.Parallel()

	store := &fakeStore{}
	if _, err := Ensure(context.Background(), store, testEncryptor(t)); err != nil {
		t.Fatalf("Ensure: %v", err)
	}
	keys := NewPublicKeys(store, 0, slog.Default())

	if got, err := keys.PublicKey(context.Background()); err != nil || got != "" {
		t.Fatalf("PublicKey = %q, %v; want nothing while no subject is saved", got, err)
	}
	store.saveSubject("mailto:push@example.com")
	if got, err := keys.PublicKey(context.Background()); err != nil || got != store.row.VapidPublicKey {
		t.Fatalf("PublicKey = %q, %v; want the stored key", got, err)
	}
}

func TestPublicKeysServesTheLastReadThroughAnOutage(t *testing.T) {
	t.Parallel()

	store := &fakeStore{}
	if _, err := Ensure(context.Background(), store, testEncryptor(t)); err != nil {
		t.Fatalf("Ensure: %v", err)
	}
	store.saveSubject("mailto:push@example.com")
	now := time.Unix(0, 0)
	keys := NewPublicKeys(store, time.Minute, slog.Default())
	keys.cache.now = func() time.Time { return now }

	want, err := keys.PublicKey(context.Background())
	if err != nil {
		t.Fatalf("PublicKey: %v", err)
	}
	if _, err := keys.PublicKey(context.Background()); err != nil || store.keyReads != 1 {
		t.Fatalf("reads = %d, %v; want the second call inside the TTL answered from memory", store.keyReads, err)
	}

	now = now.Add(2 * time.Minute)
	store.readErr = errors.New("database is down")
	if got, err := keys.PublicKey(context.Background()); err != nil || got != want {
		t.Fatalf("PublicKey during an outage = %q, %v; want the last key read", got, err)
	}
}

func TestSendersReportsWebPushThatIsNotConfigured(t *testing.T) {
	t.Parallel()

	store := &fakeStore{}
	encryptor := testEncryptor(t)
	if _, err := Ensure(context.Background(), store, encryptor); err != nil {
		t.Fatalf("Ensure: %v", err)
	}
	senders := NewSenders(store, encryptor, 0, slog.Default())

	err := senders.Send(context.Background(), push.WebPushSubscription{Endpoint: "https://push.example.com/subscription"}, push.WebPushMessage{})
	if !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("Send = %v, want ErrNotConfigured", err)
	}
}

// A client is built for the credentials it signs with, and a reread that
// finds the same ones keeps it rather than building another.
func TestSendersRebuildsOnlyWhenTheCredentialsChange(t *testing.T) {
	t.Parallel()

	store := &fakeStore{}
	encryptor := testEncryptor(t)
	if _, err := Ensure(context.Background(), store, encryptor); err != nil {
		t.Fatalf("Ensure: %v", err)
	}
	store.saveSubject("mailto:push@example.com")
	senders := NewSenders(store, encryptor, 0, slog.Default())

	first, err := senders.cache.get(context.Background())
	if err != nil || first == nil {
		t.Fatalf("client = %v, %v; want one", first, err)
	}
	second, err := senders.cache.get(context.Background())
	if err != nil || second != first {
		t.Fatalf("second client = %p, %v; want the first one kept", second, err)
	}

	store.saveSubject("https://example.com/contact")
	third, err := senders.cache.get(context.Background())
	if err != nil || third == first {
		t.Fatalf("client after a new subject = %p, %v; want a new one", third, err)
	}
}
