package platformapi

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"net/http/httptest"
	"testing"
	"time"

	"connectrpc.com/connect"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/emailsettings"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	publirasplatformv1connect "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1/publirasplatformv1connect"
	"github.com/publira/publira/server/internal/push"
	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/testutil"
	"github.com/publira/publira/server/internal/webpushsettings"
)

// newWebPushClient serves the platform API over pg the way `publira server` does. A
// second call over the same database is the same installation after a
// restart: nothing but the database carries over.
func newWebPushClient(t *testing.T, pg *testutil.PostgresEnv, encryptor emailsettings.SecretManager) publirasplatformv1connect.PlatformWebPushSettingsServiceClient {
	t.Helper()
	db := pg.OpenPlatformDB(t)
	api := newAPI(db, dbmodels.New(db), slog.Default(), encryptor, nil, testutil.TokenManager(), droppingRecorder{}, openMailGuard(), &recordingTester{})
	ts := httptest.NewServer(handlerFromServer(api.server))
	t.Cleanup(ts.Close)
	return publirasplatformv1connect.NewPlatformWebPushSettingsServiceClient(ts.Client(), ts.URL)
}

func getWebPushSettings(
	t *testing.T,
	client publirasplatformv1connect.PlatformWebPushSettingsServiceClient,
	operator testutil.PlatformOperator,
) *publirasplatformv1.PlatformWebPushSettings {
	t.Helper()
	resp, err := client.GetPlatformWebPushSettings(context.Background(), authedStorageRequest(operator, &publirasplatformv1.GetPlatformWebPushSettingsRequest{}))
	if err != nil {
		t.Fatalf("GetPlatformWebPushSettings: %v", err)
	}
	return resp.Msg.GetSettings()
}

func updateWebPushSubject(
	client publirasplatformv1connect.PlatformWebPushSettingsServiceClient,
	operator testutil.PlatformOperator,
	subject string,
	revision int64,
) (*publirasplatformv1.PlatformWebPushSettings, error) {
	resp, err := client.UpdatePlatformWebPushSubject(context.Background(), authedStorageRequest(operator, &publirasplatformv1.UpdatePlatformWebPushSubjectRequest{
		Subject:          subject,
		ExpectedRevision: revision,
	}))
	if err != nil {
		return nil, err
	}
	return resp.Msg.GetSettings(), nil
}

func storedVAPIDPrivateKey(t *testing.T, pg *testutil.PostgresEnv) string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var ciphertext string
	if err := pg.DB.QueryRowContext(ctx, `SELECT vapid_private_key_encrypted FROM platform_webpush_config`).Scan(&ciphertext); err != nil {
		t.Fatalf("read the stored private key: %v", err)
	}
	return ciphertext
}

// publishedWebPushPublicKey is what the storefront reads, as the role it reads
// with: the key, or "" when it is offered none.
func publishedWebPushPublicKey(t *testing.T, pg *testutil.PostgresEnv) string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	key, err := dbmodels.New(pg.OpenPublicDB(t)).GetPublishedWebPushPublicKey(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return ""
	}
	if err != nil {
		t.Fatalf("GetPublishedWebPushPublicKey as publira_public: %v", err)
	}
	return key
}

// workerWebPushCredentials is what the worker signs with, read as its role.
func workerWebPushCredentials(t *testing.T, pg *testutil.PostgresEnv, encryptor emailsettings.SecretManager) (webpushsettings.Credentials, error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return webpushsettings.LoadCredentials(ctx, dbmodels.New(pg.OpenOutboxDB(t)), encryptor)
}

// A fresh installation holds a key pair after its first read, with no
// environment variable naming one, and Web Push stays off everywhere until a
// subject is saved.
func TestDBGetPlatformWebPushSettingsGeneratesAPairAndIsNotConfigured(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	encryptor := storageTestEncryptor(t)
	client := newWebPushClient(t, pg, encryptor)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")

	settings := getWebPushSettings(t, client, operator)
	if settings.GetVapidPublicKey() == "" {
		t.Fatal("vapid_public_key is empty, want a generated key")
	}
	if settings.GetHasSubject() || settings.GetSubject() != "" {
		t.Fatalf("settings = %+v, want no subject", settings)
	}
	if settings.GetRevision() != 1 {
		t.Fatalf("revision = %d, want 1", settings.GetRevision())
	}

	if ciphertext := storedVAPIDPrivateKey(t, pg); !secretcrypto.IsEncryptedEnvelope(ciphertext) {
		t.Fatalf("the stored private key is %q, want an encrypted envelope", ciphertext)
	}
	if got := publishedWebPushPublicKey(t, pg); got != "" {
		t.Fatalf("the storefront reads %q, want no key before a subject is saved", got)
	}
	if _, err := workerWebPushCredentials(t, pg, encryptor); !errors.Is(err, webpushsettings.ErrNotConfigured) {
		t.Fatalf("the worker's credentials = %v, want ErrNotConfigured", err)
	}
}

// Every browser subscription is made against the stored public key, so a
// restart must answer the same pair rather than generating another.
func TestDBPlatformWebPushKeyPairSurvivesARestart(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	encryptor := storageTestEncryptor(t)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")

	first := getWebPushSettings(t, newWebPushClient(t, pg, encryptor), operator)
	ciphertext := storedVAPIDPrivateKey(t, pg)

	second := getWebPushSettings(t, newWebPushClient(t, pg, encryptor), operator)
	if second.GetVapidPublicKey() != first.GetVapidPublicKey() {
		t.Fatalf("public key after a restart = %q, want %q", second.GetVapidPublicKey(), first.GetVapidPublicKey())
	}
	if storedVAPIDPrivateKey(t, pg) != ciphertext {
		t.Fatal("the stored private key changed across a restart")
	}
	if got := countRows(t, pg, `SELECT COUNT(*) FROM platform_webpush_config`); got != 1 {
		t.Fatalf("platform_webpush_config rows = %d, want 1", got)
	}
}

// Saving a subject turns Web Push on: the storefront publishes the key and the
// worker opens a pair that signs. Neither the response nor the row carries the
// private key in the clear, and the change is audited with the write.
func TestDBUpdatePlatformWebPushSubjectConfiguresWebPush(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	encryptor := storageTestEncryptor(t)
	client := newWebPushClient(t, pg, encryptor)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")

	read := getWebPushSettings(t, client, operator)
	saved, err := updateWebPushSubject(client, operator, "  mailto:push@example.com  ", read.GetRevision())
	if err != nil {
		t.Fatalf("UpdatePlatformWebPushSubject: %v", err)
	}
	if !saved.GetHasSubject() || saved.GetSubject() != "mailto:push@example.com" {
		t.Fatalf("saved = %+v, want the trimmed subject", saved)
	}
	if saved.GetRevision() != read.GetRevision()+1 {
		t.Fatalf("revision = %d, want %d", saved.GetRevision(), read.GetRevision()+1)
	}
	if saved.GetVapidPublicKey() != read.GetVapidPublicKey() {
		t.Fatal("saving a subject changed the public key")
	}

	if got := publishedWebPushPublicKey(t, pg); got != read.GetVapidPublicKey() {
		t.Fatalf("the storefront reads %q, want the stored key", got)
	}
	credentials, err := workerWebPushCredentials(t, pg, encryptor)
	if err != nil {
		t.Fatalf("the worker's credentials: %v", err)
	}
	if _, err := push.NewWebPushClient(push.WebPushConfig{
		VAPIDPublicKey:  credentials.PublicKey,
		VAPIDPrivateKey: credentials.PrivateKey,
		Subscriber:      credentials.Subject,
	}); err != nil {
		t.Fatalf("the worker cannot sign with the stored pair: %v", err)
	}
	if storedVAPIDPrivateKey(t, pg) == credentials.PrivateKey {
		t.Fatal("the private key is stored in the clear")
	}

	if got := countRows(t, pg, `SELECT COUNT(*) FROM platform_audit_logs WHERE action = 'platform_webpush_subject_updated' AND target_type = 'webpush_config'`); got != 1 {
		t.Fatalf("platform_webpush_subject_updated audit rows = %d, want 1", got)
	}
}

func TestDBUpdatePlatformWebPushSubjectRefusesAnInvalidSubject(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	client := newWebPushClient(t, pg, storageTestEncryptor(t))
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")
	read := getWebPushSettings(t, client, operator)

	for _, tc := range []struct {
		subject  string
		revision int64
		field    string
	}{
		{subject: "", revision: read.GetRevision(), field: "subject"},
		{subject: "push@example.com", revision: read.GetRevision(), field: "subject"},
		{subject: "http://example.com", revision: read.GetRevision(), field: "subject"},
		{subject: "mailto:push@example.com", revision: 0, field: "expected_revision"},
	} {
		_, err := updateWebPushSubject(client, operator, tc.subject, tc.revision)
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("UpdatePlatformWebPushSubject(%q, %d) code = %v, want invalid_argument", tc.subject, tc.revision, connect.CodeOf(err))
		}
		assertFieldViolation(t, err, tc.field)
	}
	if got := getWebPushSettings(t, client, operator); got.GetHasSubject() || got.GetRevision() != read.GetRevision() {
		t.Fatalf("settings = %+v, want nothing saved", got)
	}
}

// A save based on a read another session has since saved over would roll that
// save back, so it is refused.
func TestDBUpdatePlatformWebPushSubjectRefusesAStaleRevision(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	client := newWebPushClient(t, pg, storageTestEncryptor(t))
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")
	read := getWebPushSettings(t, client, operator)

	if _, err := updateWebPushSubject(client, operator, "mailto:first@example.com", read.GetRevision()); err != nil {
		t.Fatalf("UpdatePlatformWebPushSubject: %v", err)
	}
	if _, err := updateWebPushSubject(client, operator, "mailto:second@example.com", read.GetRevision()); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("stale UpdatePlatformWebPushSubject code = %v, want failed_precondition", connect.CodeOf(err))
	}
	if got := getWebPushSettings(t, client, operator); got.GetSubject() != "mailto:first@example.com" {
		t.Fatalf("subject = %q, want the first save kept", got.GetSubject())
	}
}

// No key pair has been generated to save a subject against until the settings
// are read, so a save that names a revision nothing was read at is refused.
func TestDBUpdatePlatformWebPushSubjectRefusesASaveBeforeAnyRead(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	client := newWebPushClient(t, pg, storageTestEncryptor(t))
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")

	if _, err := updateWebPushSubject(client, operator, "mailto:push@example.com", 1); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("UpdatePlatformWebPushSubject code = %v, want failed_precondition", connect.CodeOf(err))
	}
	if got := countRows(t, pg, `SELECT COUNT(*) FROM platform_webpush_config`); got != 0 {
		t.Fatalf("platform_webpush_config rows = %d, want none", got)
	}
}

// A process started without secret encryption keys has nothing to seal a
// private key with, and says so rather than storing one in the clear.
func TestDBGetPlatformWebPushSettingsWithoutEncryptionKeys(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	client := newWebPushClient(t, pg, nil)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")

	_, err := client.GetPlatformWebPushSettings(context.Background(), authedStorageRequest(operator, &publirasplatformv1.GetPlatformWebPushSettingsRequest{}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("GetPlatformWebPushSettings code = %v, want failed_precondition", connect.CodeOf(err))
	}
	if got := countRows(t, pg, `SELECT COUNT(*) FROM platform_webpush_config`); got != 0 {
		t.Fatalf("platform_webpush_config rows = %d, want none", got)
	}
}

// An auditor may read the settings, which generates the pair, but may not turn
// Web Push on.
func TestDBPlatformAuditorCannotUpdateTheWebPushSubject(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	client := newWebPushClient(t, pg, storageTestEncryptor(t))
	auditor := pg.SeedPlatformAuditor(t, "PLATAUDIT01", "auditor@example.com", "Platform Auditor")

	read := getWebPushSettings(t, client, auditor)
	if _, err := updateWebPushSubject(client, auditor, "mailto:push@example.com", read.GetRevision()); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("UpdatePlatformWebPushSubject code = %v, want permission_denied", connect.CodeOf(err))
	}
}
