package fcmsettings

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/push"
	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/testutil"
)

func testEncryptor(t *testing.T) *secretcrypto.Manager {
	t.Helper()
	manager, err := secretcrypto.NewManager(map[string][]byte{"k1": make([]byte, 32)}, "k1")
	if err != nil {
		t.Fatalf("secretcrypto.NewManager: %v", err)
	}
	return manager
}

// fakeStore is tenant_fcm_config, one row per tenant.
type fakeStore struct {
	rows    map[uuid.UUID]dbmodels.TenantFcmConfig
	reads   int
	readErr error
}

func newFakeStore() *fakeStore {
	return &fakeStore{rows: make(map[uuid.UUID]dbmodels.TenantFcmConfig)}
}

func (f *fakeStore) GetTenantFcmConfig(_ context.Context, tenantID uuid.UUID) (dbmodels.TenantFcmConfig, error) {
	f.reads++
	if f.readErr != nil {
		return dbmodels.TenantFcmConfig{}, f.readErr
	}
	row, ok := f.rows[tenantID]
	if !ok {
		return dbmodels.TenantFcmConfig{}, sql.ErrNoRows
	}
	return row, nil
}

func (f *fakeStore) UpsertTenantFcmConfig(_ context.Context, arg dbmodels.UpsertTenantFcmConfigParams) (dbmodels.TenantFcmConfig, error) {
	row := dbmodels.TenantFcmConfig{
		TenantID:                    arg.TenantID,
		ProjectID:                   arg.ProjectID,
		ClientEmail:                 arg.ClientEmail,
		ServiceAccountJsonEncrypted: arg.ServiceAccountJsonEncrypted,
		UpdatedAt:                   time.Now(),
	}
	f.rows[arg.TenantID] = row
	return row, nil
}

func (f *fakeStore) DeleteTenantFcmConfig(_ context.Context, tenantID uuid.UUID) (int64, error) {
	if _, ok := f.rows[tenantID]; !ok {
		return 0, nil
	}
	delete(f.rows, tenantID)
	return 1, nil
}

type fakeRecorder struct {
	entries []auditlog.TenantEntry
}

func (r *fakeRecorder) RecordPlatform(context.Context, auditlog.PlatformEntry) {}

func (r *fakeRecorder) RecordTenant(_ context.Context, entry auditlog.TenantEntry) {
	r.entries = append(r.entries, entry)
}

func testAudit() AuditMeta {
	return AuditMeta{ActorUserID: uuid.New(), ActorRole: "tenant_admin", ClientIP: "198.51.100.1", TargetID: "TENANT000001"}
}

func TestValidate(t *testing.T) {
	t.Parallel()

	keyJSON := testutil.ServiceAccountJSON(t, "tenant-a", "push@tenant-a.iam.gserviceaccount.com")
	for _, tc := range []struct {
		name      string
		projectID string
		keyJSON   string
		want      error
	}{
		{name: "the key's own project", projectID: " tenant-a ", keyJSON: keyJSON},
		{name: "no project", projectID: " ", keyJSON: keyJSON, want: ErrProjectIDRequired},
		{name: "another project", projectID: "tenant-b", keyJSON: keyJSON, want: ErrProjectMismatch},
		{name: "not a key", projectID: "tenant-a", keyJSON: `{"type":"authorized_user"}`, want: ErrInvalidCredentials},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			account, err := Validate(tc.projectID, tc.keyJSON)
			if tc.want == nil {
				if err != nil {
					t.Fatalf("Validate = %v, want nil", err)
				}
				if account.ClientEmail != "push@tenant-a.iam.gserviceaccount.com" {
					t.Fatalf("client email = %q", account.ClientEmail)
				}
				return
			}
			if !errors.Is(err, tc.want) {
				t.Fatalf("Validate = %v, want %v", err, tc.want)
			}
		})
	}
}

func TestCredentialsFormatRedacted(t *testing.T) {
	t.Parallel()

	credentials := Credentials{ProjectID: "tenant-a", ServiceAccountJSON: `{"private_key":"the-private-key"}`}
	for _, formatted := range []string{
		fmt.Sprintf("%v", credentials),
		fmt.Sprintf("%+v", credentials),
		fmt.Sprintf("%#v", credentials),
		credentials.LogValue().String(),
	} {
		if strings.Contains(formatted, "the-private-key") {
			t.Fatalf("formatted credentials = %q, want the key left out", formatted)
		}
	}
}

// What is stored is an envelope, what is answered names the account and not
// the key, and the change is audited without the key either.
func TestStoreSaveSealsTheKeyAndAnswersOnlyItsDescription(t *testing.T) {
	t.Parallel()

	store := newFakeStore()
	recorder := &fakeRecorder{}
	encryptor := testEncryptor(t)
	tenantID := uuid.New()
	keyJSON := testutil.ServiceAccountJSON(t, "tenant-a", "push@tenant-a.iam.gserviceaccount.com")

	settings, err := New(store, encryptor, recorder).Save(context.Background(), tenantID, "tenant-a", keyJSON, testAudit())
	if err != nil {
		t.Fatalf("Save: %v", err)
	}
	want := Settings{Configured: true, ProjectID: "tenant-a", ClientEmail: "push@tenant-a.iam.gserviceaccount.com", UpdatedAt: settings.UpdatedAt}
	if settings != want {
		t.Fatalf("settings = %+v, want %+v", settings, want)
	}

	row := store.rows[tenantID]
	if !secretcrypto.IsEncryptedEnvelope(row.ServiceAccountJsonEncrypted) || strings.Contains(row.ServiceAccountJsonEncrypted, "PRIVATE KEY") {
		t.Fatalf("stored key = %q, want an encrypted envelope", row.ServiceAccountJsonEncrypted)
	}
	opened, err := encryptor.DecryptString(row.ServiceAccountJsonEncrypted)
	if err != nil || opened != keyJSON {
		t.Fatalf("the stored envelope does not open to the submitted key: %v", err)
	}

	if len(recorder.entries) != 1 {
		t.Fatalf("audit entries = %d, want 1", len(recorder.entries))
	}
	entry := recorder.entries[0]
	if entry.Action != ActionSaved || entry.TargetType != TargetType || entry.TargetID != "TENANT000001" || entry.Outcome != auditlog.OutcomeSuccess {
		t.Fatalf("audit entry = %+v", entry)
	}
	if strings.Contains(fmt.Sprintf("%+v", entry), "PRIVATE KEY") {
		t.Fatal("the audit entry carries the key")
	}
}

func TestStoreSaveRefusesAnInvalidKeyWithoutStoringOrAuditing(t *testing.T) {
	t.Parallel()

	store := newFakeStore()
	recorder := &fakeRecorder{}
	tenantID := uuid.New()
	keyJSON := testutil.ServiceAccountJSON(t, "tenant-a", "push@tenant-a.iam.gserviceaccount.com")

	_, err := New(store, testEncryptor(t), recorder).Save(context.Background(), tenantID, "tenant-b", keyJSON, testAudit())
	if !errors.Is(err, ErrProjectMismatch) {
		t.Fatalf("Save = %v, want ErrProjectMismatch", err)
	}
	if len(store.rows) != 0 || len(recorder.entries) != 0 {
		t.Fatalf("rows = %d, audit entries = %d, want none", len(store.rows), len(recorder.entries))
	}
}

func TestStoreSaveRefusesToStoreAKeyItCannotSeal(t *testing.T) {
	t.Parallel()

	store := newFakeStore()
	keyJSON := testutil.ServiceAccountJSON(t, "tenant-a", "push@tenant-a.iam.gserviceaccount.com")
	_, err := New(store, nil, nil).Save(context.Background(), uuid.New(), "tenant-a", keyJSON, testAudit())
	if !errors.Is(err, ErrSecretManagerUnavailable) {
		t.Fatalf("Save = %v, want ErrSecretManagerUnavailable", err)
	}
	if len(store.rows) != 0 {
		t.Fatal("a key was stored without being sealed")
	}
}

func TestStoreDeleteRemovesTheCredentials(t *testing.T) {
	t.Parallel()

	store := newFakeStore()
	recorder := &fakeRecorder{}
	s := New(store, testEncryptor(t), recorder)
	tenantID := uuid.New()
	keyJSON := testutil.ServiceAccountJSON(t, "tenant-a", "push@tenant-a.iam.gserviceaccount.com")
	if _, err := s.Save(context.Background(), tenantID, "tenant-a", keyJSON, testAudit()); err != nil {
		t.Fatalf("Save: %v", err)
	}

	if err := s.Delete(context.Background(), tenantID, testAudit()); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	settings, err := s.Get(context.Background(), tenantID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if settings != (Settings{}) {
		t.Fatalf("settings after delete = %+v, want unconfigured", settings)
	}
	if len(recorder.entries) != 2 || recorder.entries[1].Action != ActionDeleted {
		t.Fatalf("audit entries = %+v, want a save and a delete", recorder.entries)
	}

	// Deleting what is not there changes nothing, so nothing is audited.
	if err := s.Delete(context.Background(), tenantID, testAudit()); err != nil {
		t.Fatalf("second Delete: %v", err)
	}
	if len(recorder.entries) != 2 {
		t.Fatalf("audit entries = %d after deleting nothing, want 2", len(recorder.entries))
	}
}

// recordingClient stands in for a Firebase client and remembers the
// credentials it was built with.
type recordingClient struct {
	config push.Config
	sent   []push.Message
}

func (c *recordingClient) Send(_ context.Context, message push.Message) error {
	c.sent = append(c.sent, message)
	return nil
}

type clientFactory struct {
	built []*recordingClient
}

func (f *clientFactory) newClient(_ context.Context, cfg push.Config) (Sender, error) {
	client := &recordingClient{config: cfg}
	f.built = append(f.built, client)
	return client, nil
}

func saveKey(t *testing.T, store *fakeStore, encryptor *secretcrypto.Manager, tenantID uuid.UUID, projectID string) string {
	t.Helper()
	keyJSON := testutil.ServiceAccountJSON(t, projectID, "push@"+projectID+".iam.gserviceaccount.com")
	if _, err := New(store, encryptor, nil).Save(context.Background(), tenantID, projectID, keyJSON, AuditMeta{}); err != nil {
		t.Fatalf("Save: %v", err)
	}
	return keyJSON
}

func TestSendersSendEachTenantWithItsOwnCredentials(t *testing.T) {
	t.Parallel()

	store := newFakeStore()
	encryptor := testEncryptor(t)
	tenantA, tenantB := uuid.New(), uuid.New()
	keyA := saveKey(t, store, encryptor, tenantA, "tenant-a")
	keyB := saveKey(t, store, encryptor, tenantB, "tenant-b")

	factory := &clientFactory{}
	senders := NewSenders(store, encryptor, factory.newClient, time.Hour, nil)
	for _, tenantID := range []uuid.UUID{tenantA, tenantB, tenantA} {
		if err := senders.Send(context.Background(), tenantID, push.Message{Token: "token-" + tenantID.String()}); err != nil {
			t.Fatalf("Send: %v", err)
		}
	}

	if len(factory.built) != 2 {
		t.Fatalf("clients built = %d, want one per tenant", len(factory.built))
	}
	for i, want := range []struct {
		projectID string
		keyJSON   string
		sent      int
	}{
		{projectID: "tenant-a", keyJSON: keyA, sent: 2},
		{projectID: "tenant-b", keyJSON: keyB, sent: 1},
	} {
		client := factory.built[i]
		if client.config.ProjectID != want.projectID || string(client.config.CredentialsJSON) != want.keyJSON {
			t.Fatalf("client %d was built for %q with another key, want %q", i, client.config.ProjectID, want.projectID)
		}
		if len(client.sent) != want.sent {
			t.Fatalf("client %d sent %d messages, want %d", i, len(client.sent), want.sent)
		}
	}
}

func TestSendersReportATenantWithoutCredentials(t *testing.T) {
	t.Parallel()

	factory := &clientFactory{}
	senders := NewSenders(newFakeStore(), testEncryptor(t), factory.newClient, time.Hour, nil)
	err := senders.Send(context.Background(), uuid.New(), push.Message{Token: "token"})
	if !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("Send = %v, want ErrNotConfigured", err)
	}
	if len(factory.built) != 0 {
		t.Fatalf("clients built = %d, want none", len(factory.built))
	}
}

// Within the TTL the row is not read again; past it, a replacement is sent
// with and a removal turns mobile push off, all without a restart.
func TestSendersFollowAReplacementAndARemovalOnceTheTTLPasses(t *testing.T) {
	t.Parallel()

	store := newFakeStore()
	encryptor := testEncryptor(t)
	tenantID := uuid.New()
	saveKey(t, store, encryptor, tenantID, "tenant-a")

	factory := &clientFactory{}
	cached := NewSenders(store, encryptor, factory.newClient, time.Hour, nil)
	send := func(s *Senders) error {
		return s.Send(context.Background(), tenantID, push.Message{Token: "token"})
	}
	if err := send(cached); err != nil {
		t.Fatalf("Send: %v", err)
	}
	reads := store.reads
	if err := send(cached); err != nil {
		t.Fatalf("Send: %v", err)
	}
	if store.reads != reads {
		t.Fatal("the row was read again within the TTL")
	}

	// A TTL of zero makes every send one that follows the TTL passing.
	senders := NewSenders(store, encryptor, factory.newClient, 0, nil)
	if err := send(senders); err != nil {
		t.Fatalf("Send: %v", err)
	}
	built := len(factory.built)
	if err := send(senders); err != nil {
		t.Fatalf("Send: %v", err)
	}
	if len(factory.built) != built {
		t.Fatal("an unchanged row built a second client")
	}

	replacement := saveKey(t, store, encryptor, tenantID, "tenant-a-2")
	if err := send(senders); err != nil {
		t.Fatalf("Send after replacing: %v", err)
	}
	latest := factory.built[len(factory.built)-1]
	if latest.config.ProjectID != "tenant-a-2" || string(latest.config.CredentialsJSON) != replacement {
		t.Fatalf("sent with project %q after the replacement, want tenant-a-2", latest.config.ProjectID)
	}

	if err := New(store, encryptor, nil).Delete(context.Background(), tenantID, AuditMeta{}); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if err := send(senders); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("Send after removing = %v, want ErrNotConfigured", err)
	}
}

// An outage serves the credentials already read rather than failing every
// delivery the moment the TTL passes.
func TestSendersKeepSendingThroughAnOutage(t *testing.T) {
	t.Parallel()

	store := newFakeStore()
	encryptor := testEncryptor(t)
	tenantID := uuid.New()
	saveKey(t, store, encryptor, tenantID, "tenant-a")

	factory := &clientFactory{}
	senders := NewSenders(store, encryptor, factory.newClient, 0, nil)
	if err := senders.Send(context.Background(), tenantID, push.Message{Token: "token"}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	store.readErr = errors.New("database is down")
	if err := senders.Send(context.Background(), tenantID, push.Message{Token: "token"}); err != nil {
		t.Fatalf("Send during the outage = %v, want the last credentials used", err)
	}
}
