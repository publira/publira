package main

import (
	"bytes"
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"log/slog"
	"strings"
	"testing"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/push"
	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/testutil"
	"github.com/publira/publira/server/internal/webpushsettings"
)

// webPushCommand runs one webpush command against the database
// PUBLIRA_PLATFORM_DB_URL names, and returns its exit code and what it printed.
func webPushCommand(t *testing.T, args ...string) (code int, stdout, stderr string) {
	t.Helper()
	var out, errOut bytes.Buffer
	code = runGroup(&webPushGroup, args, pipedConsole("", &errOut), &out)
	return code, out.String(), errOut.String()
}

func mustWebPushCommand(t *testing.T, args ...string) string {
	t.Helper()
	code, stdout, stderr := webPushCommand(t, args...)
	if code != 0 {
		t.Fatalf("webpush %s: exit code = %d\n%s", strings.Join(args, " "), code, stderr)
	}
	return stdout
}

// showLine is the value show prints under label.
func showLine(t *testing.T, show, label string) string {
	t.Helper()
	for line := range strings.Lines(show) {
		if value, ok := strings.CutPrefix(line, label+":"); ok {
			return strings.TrimSpace(value)
		}
	}
	t.Fatalf("show = \n%s\nhas no %s line", show, label)
	return ""
}

func storedVAPIDKeyPair(t *testing.T, pg *testutil.PostgresEnv) (publicKey, encryptedPrivateKey string) {
	t.Helper()
	if err := pg.DB.QueryRowContext(context.Background(),
		`SELECT vapid_public_key, vapid_private_key_encrypted FROM platform_webpush_config`,
	).Scan(&publicKey, &encryptedPrivateKey); err != nil {
		t.Fatalf("read platform_webpush_config: %v", err)
	}
	return publicKey, encryptedPrivateKey
}

// testEncryptor opens what a command encrypted with the keys setEncryptionKeys
// sets, as the servers do.
func testEncryptor(t *testing.T) *secretcrypto.Manager {
	t.Helper()
	manager, err := secretcrypto.NewManager(map[string][]byte{"k1": bytes.Repeat([]byte{7}, 32)}, "k1")
	if err != nil {
		t.Fatalf("secretcrypto.NewManager: %v", err)
	}
	return manager
}

// browserSubscription is what a browser hands the storefront: an endpoint and
// the keys a payload is encrypted to.
func browserSubscription(t *testing.T, endpoint string) push.WebPushSubscription {
	t.Helper()
	key, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate the subscription key: %v", err)
	}
	return push.WebPushSubscription{
		Endpoint: endpoint,
		P256dh:   base64.RawURLEncoding.EncodeToString(key.PublicKey().Bytes()),
		Auth:     base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{1}, 16)),
	}
}

// The storefront and the worker are already running when an operator turns
// Web Push on, and pick the saved subject up on their next read.
func TestWebPushInitTurnsWebPushOnWithoutARestart(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	t.Setenv("PUBLIRA_PLATFORM_DB_URL", pg.PlatformURL)
	setEncryptionKeys(t)
	ctx := context.Background()

	storefront := webpushsettings.NewPublicKeys(dbmodels.New(pg.OpenPublicDB(t)), 0, slog.Default())
	worker := webpushsettings.NewSenders(dbmodels.New(pg.OpenOutboxDB(t)), testEncryptor(t), 0, slog.Default())
	// The push client refuses every address a test can serve, so a delivery
	// that gets as far as dialing is one signed with the stored pair.
	subscription := browserSubscription(t, "https://127.0.0.1/push/subscription")

	if got := mustWebPushCommand(t, "show"); got != "No VAPID key pair is stored, so Web Push is off\n" {
		t.Fatalf("show before init = %q", got)
	}
	if key, err := storefront.PublicKey(ctx); err != nil || key != "" {
		t.Fatalf("the storefront's key before init = %q, %v; want none", key, err)
	}
	if err := worker.Send(ctx, subscription, push.WebPushMessage{Title: "New episode"}); !errors.Is(err, webpushsettings.ErrNotConfigured) {
		t.Fatalf("a delivery before init = %v, want ErrNotConfigured", err)
	}

	if got := mustWebPushCommand(t, "init", "--subject", "  mailto:push@example.com  "); got != "Saved the Web Push subject mailto:push@example.com, revision 2\n" {
		t.Fatalf("init = %q", got)
	}

	show := mustWebPushCommand(t, "show")
	if got := showLine(t, show, "Subject"); got != "mailto:push@example.com" {
		t.Fatalf("show's subject = %q", got)
	}
	publicKey, encryptedPrivateKey := storedVAPIDKeyPair(t, pg)
	if got := showLine(t, show, "VAPID public key"); got != publicKey {
		t.Fatalf("show's public key = %q, want the stored %q", got, publicKey)
	}
	credentials, err := webpushsettings.LoadCredentials(ctx, dbmodels.New(pg.OpenOutboxDB(t)), testEncryptor(t))
	if err != nil {
		t.Fatalf("the worker's credentials: %v", err)
	}
	if strings.Contains(show, credentials.PrivateKey) || strings.Contains(show, encryptedPrivateKey) {
		t.Fatalf("show printed the private key:\n%s", show)
	}

	if key, err := storefront.PublicKey(ctx); err != nil || key != publicKey {
		t.Fatalf("the storefront's key after init = %q, %v; want %q", key, err, publicKey)
	}
	err = worker.Send(ctx, subscription, push.WebPushMessage{Title: "New episode"})
	if err == nil || !strings.Contains(err.Error(), "restricted address") {
		t.Fatalf("a delivery after init = %v, want one refused only at the restricted address", err)
	}
}

// Every browser subscription is made against the stored public key, so a
// second init changes the subject and nothing else.
func TestWebPushInitAgainKeepsTheKeyPair(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	t.Setenv("PUBLIRA_PLATFORM_DB_URL", pg.PlatformURL)
	setEncryptionKeys(t)

	mustWebPushCommand(t, "init", "--subject", "mailto:push@example.com")
	publicKey, encryptedPrivateKey := storedVAPIDKeyPair(t, pg)

	if got := mustWebPushCommand(t, "init", "--subject", "https://example.com/contact"); got != "Saved the Web Push subject https://example.com/contact, revision 3\n" {
		t.Fatalf("a second init = %q", got)
	}
	if gotPublic, gotPrivate := storedVAPIDKeyPair(t, pg); gotPublic != publicKey || gotPrivate != encryptedPrivateKey {
		t.Fatal("a second init replaced the key pair")
	}
	if got := platformActions(t, pg); got != "platform_webpush_subject_updated,platform_webpush_subject_updated" {
		t.Fatalf("audit actions = %s", got)
	}

	// Keeping the pair needs no key to seal one with.
	t.Setenv("PUBLIRA_SECRET_ENCRYPTION_KEYS", "")
	t.Setenv("PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID", "")
	mustWebPushCommand(t, "init", "--subject", "mailto:ops@example.com")
	if gotPublic, gotPrivate := storedVAPIDKeyPair(t, pg); gotPublic != publicKey || gotPrivate != encryptedPrivateKey {
		t.Fatal("an init without encryption keys replaced the key pair")
	}
}

// Nothing is generated or written when the subject is refused, or when there
// is no key to seal a new private key with.
func TestWebPushInitRefusalsWriteNothing(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	t.Setenv("PUBLIRA_PLATFORM_DB_URL", pg.PlatformURL)
	setEncryptionKeys(t)

	for _, args := range [][]string{
		{"init"},
		{"init", "--subject", "push@example.com"},
		{"init", "--subject", "http://example.com/contact"},
	} {
		code, _, stderr := webPushCommand(t, args...)
		if code != 1 || !strings.Contains(stderr, "--subject: subject must be a mailto: URI with an address or an absolute https: URL") {
			t.Fatalf("webpush %s: exit code = %d\n%s", strings.Join(args, " "), code, stderr)
		}
	}

	t.Setenv("PUBLIRA_SECRET_ENCRYPTION_KEYS", "")
	t.Setenv("PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID", "")
	code, _, stderr := webPushCommand(t, "init", "--subject", "mailto:push@example.com")
	if code != 1 || !strings.Contains(stderr, errNoEncryptionKeys.Error()) {
		t.Fatalf("init without encryption keys: exit code = %d\n%s", code, stderr)
	}

	var rows int
	if err := pg.DB.QueryRowContext(context.Background(), `SELECT COUNT(*) FROM platform_webpush_config`).Scan(&rows); err != nil {
		t.Fatalf("count platform_webpush_config: %v", err)
	}
	if rows != 0 || platformActions(t, pg) != "" {
		t.Fatalf("a refused init left %d rows and audit actions %q", rows, platformActions(t, pg))
	}
}

// A row the Platform Console generated by reading the settings holds a pair
// but no subject, and show says Web Push is still off.
func TestWebPushShowBeforeASubjectIsSaved(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	t.Setenv("PUBLIRA_PLATFORM_DB_URL", pg.PlatformURL)
	config, err := webpushsettings.Ensure(context.Background(), dbmodels.New(pg.OpenPlatformDB(t)), testEncryptor(t))
	if err != nil {
		t.Fatalf("Ensure: %v", err)
	}

	show := mustWebPushCommand(t, "show")
	if got := showLine(t, show, "Subject"); got != "none, so Web Push is off" {
		t.Fatalf("show's subject = %q", got)
	}
	if got := showLine(t, show, "VAPID public key"); got != config.VapidPublicKey {
		t.Fatalf("show's public key = %q, want %q", got, config.VapidPublicKey)
	}
}
