package platformapi

import (
	"context"
	"log/slog"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	publirasplatformv1connect "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1/publirasplatformv1connect"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/storagesettings"
	"github.com/publira/publira/server/internal/testutil"
)

// recordingTester answers with the checks it was given and keeps what it was
// asked to test, which is how a case asserts the credential the handler
// resolved without any store being involved.
type recordingTester struct {
	mu          sync.Mutex
	checks      []storagesettings.Check
	err         error
	settings    storagesettings.Settings
	credentials storagesettings.Credentials
	calls       int
}

func (r *recordingTester) TestConnection(
	_ context.Context,
	settings storagesettings.Settings,
	credentials storagesettings.Credentials,
) ([]storagesettings.Check, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls++
	r.settings, r.credentials = settings, credentials
	return r.checks, r.err
}

func (r *recordingTester) snapshot() (storagesettings.Settings, storagesettings.Credentials, int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.settings, r.credentials, r.calls
}

func passingChecks() []storagesettings.Check {
	return []storagesettings.Check{
		{Operation: storagesettings.OperationPutObject},
		{Operation: storagesettings.OperationGetObject},
		{Operation: storagesettings.OperationListObjects},
		{Operation: storagesettings.OperationDeleteObject},
	}
}

func storageTestEncryptor(t *testing.T) *secretcrypto.Manager {
	t.Helper()
	manager, err := secretcrypto.NewManager(map[string][]byte{"k1": make([]byte, 32)}, "k1")
	if err != nil {
		t.Fatalf("secretcrypto.NewManager: %v", err)
	}
	return manager
}

func newStorageClient(t *testing.T, tester storagesettings.Tester) (
	publirasplatformv1connect.PlatformStorageSettingsServiceClient,
	*testutil.PostgresEnv,
	testutil.PlatformOperator,
) {
	t.Helper()

	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	db := pg.OpenPlatformDB(t)

	api := newAPI(db, dbmodels.New(db), slog.Default(), storageTestEncryptor(t), nil, testutil.TokenManager(), nil, openMailGuard(), tester)
	ts := httptest.NewServer(handlerFromServer(api.server))
	t.Cleanup(ts.Close)

	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")
	return publirasplatformv1connect.NewPlatformStorageSettingsServiceClient(ts.Client(), ts.URL), pg, operator
}

// authedStorageRequest is newDBAuthedRequest over a message the caller already
// holds a pointer to. A protobuf message carries a mutex, so a helper that
// takes one by value cannot be handed a variable.
func authedStorageRequest[T any](operator testutil.PlatformOperator, msg *T) *connect.Request[T] {
	req := connect.NewRequest(msg)
	req.Header().Set("Authorization", "Bearer "+issueDBIntegrationToken(operator))
	return req
}

func storageUpdateRequest(revision int64) *publirasplatformv1.UpdatePlatformStorageSettingsRequest {
	return &publirasplatformv1.UpdatePlatformStorageSettingsRequest{
		Bucket:                    "publira-objects",
		Region:                    "ap-northeast-1",
		Endpoint:                  "https://s3.example.com",
		ForcePathStyle:            true,
		PublicBaseUrl:             "https://cdn.example.com",
		AccessKeyId:               "AKIAEXAMPLE",
		SecretAccessKeyUpdateMode: publirasplatformv1.SecretUpdateMode_SECRET_UPDATE_MODE_REPLACE,
		SecretAccessKey:           "the-secret-access-key",
		ExpectedRevision:          revision,
	}
}

func updateStorageSettings(
	t *testing.T,
	client publirasplatformv1connect.PlatformStorageSettingsServiceClient,
	operator testutil.PlatformOperator,
	req *publirasplatformv1.UpdatePlatformStorageSettingsRequest,
) (*publirasplatformv1.PlatformStorageSettings, error) {
	t.Helper()
	resp, err := client.UpdatePlatformStorageSettings(context.Background(), authedStorageRequest(operator, req))
	if err != nil {
		return nil, err
	}
	return resp.Msg.GetSettings(), nil
}

func getStorageSettings(
	t *testing.T,
	client publirasplatformv1connect.PlatformStorageSettingsServiceClient,
	operator testutil.PlatformOperator,
) *publirasplatformv1.PlatformStorageSettings {
	t.Helper()
	resp, err := client.GetPlatformStorageSettings(context.Background(), authedStorageRequest(operator, &publirasplatformv1.GetPlatformStorageSettingsRequest{}))
	if err != nil {
		t.Fatalf("GetPlatformStorageSettings: %v", err)
	}
	return resp.Msg.GetSettings()
}

func storedSecretCiphertext(t *testing.T, pg *testutil.PostgresEnv) string {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var ciphertext string
	if err := pg.DB.QueryRowContext(ctx, `SELECT COALESCE(secret_access_key_encrypted, '') FROM platform_storage_config`).Scan(&ciphertext); err != nil {
		t.Fatalf("read the stored secret access key: %v", err)
	}
	return ciphertext
}

// An installation that has saved nothing is not configured, which it says by
// answering revision zero rather than by failing the read.
func TestDBGetPlatformStorageSettingsAnswersNotConfigured(t *testing.T) {
	client, _, operator := newStorageClient(t, &recordingTester{checks: passingChecks()})

	settings := getStorageSettings(t, client, operator)
	if settings.GetRevision() != 0 {
		t.Fatalf("revision = %d, want 0", settings.GetRevision())
	}
	if settings.GetBucket() != "" || settings.GetHasSecretAccessKey() {
		t.Fatalf("settings = %+v, want nothing configured", settings)
	}
}

func TestDBUpdatePlatformStorageSettingsSavesTheConfigurationAndEncryptsTheSecret(t *testing.T) {
	client, pg, operator := newStorageClient(t, &recordingTester{checks: passingChecks()})

	saved, err := updateStorageSettings(t, client, operator, storageUpdateRequest(0))
	if err != nil {
		t.Fatalf("UpdatePlatformStorageSettings: %v", err)
	}
	if saved.GetRevision() != 1 {
		t.Fatalf("revision = %d, want 1", saved.GetRevision())
	}
	if saved.GetBucket() != "publira-objects" || saved.GetAccessKeyId() != "AKIAEXAMPLE" || !saved.GetHasSecretAccessKey() {
		t.Fatalf("saved = %+v, want the configuration the request stated", saved)
	}

	// The secret is held, and neither the response nor the row carries it in
	// the clear.
	ciphertext := storedSecretCiphertext(t, pg)
	if !secretcrypto.IsEncryptedEnvelope(ciphertext) {
		t.Fatalf("the stored secret access key is %q, want an encrypted envelope", ciphertext)
	}
	if got := getStorageSettings(t, client, operator); got.GetRevision() != 1 || !got.GetHasSecretAccessKey() {
		t.Fatalf("the read answered %+v, want the saved configuration", got)
	}
}

// The console edits a bucket or an endpoint far more often than a credential,
// and an operator who has to paste the secret again to move a comma is one who
// will keep it somewhere they should not.
func TestDBUpdatePlatformStorageSettingsKeepsTheStoredSecretWhenNoneIsSent(t *testing.T) {
	client, pg, operator := newStorageClient(t, &recordingTester{checks: passingChecks()})

	if _, err := updateStorageSettings(t, client, operator, storageUpdateRequest(0)); err != nil {
		t.Fatalf("UpdatePlatformStorageSettings: %v", err)
	}
	first := storedSecretCiphertext(t, pg)

	unchanged := storageUpdateRequest(1)
	unchanged.Bucket = "publira-objects-2"
	unchanged.SecretAccessKeyUpdateMode = publirasplatformv1.SecretUpdateMode_SECRET_UPDATE_MODE_UNCHANGED
	unchanged.SecretAccessKey = ""
	saved, err := updateStorageSettings(t, client, operator, unchanged)
	if err != nil {
		t.Fatalf("UpdatePlatformStorageSettings(unchanged secret): %v", err)
	}
	if saved.GetBucket() != "publira-objects-2" || !saved.GetHasSecretAccessKey() {
		t.Fatalf("saved = %+v, want the new bucket and the stored credential", saved)
	}
	if got := storedSecretCiphertext(t, pg); got != first {
		t.Fatalf("the stored secret access key changed to %q, want the one already there", got)
	}
}

// Clearing the credential is how an installation moves to the credentials each
// process finds for itself, so it is a save like any other rather than a gap.
func TestDBUpdatePlatformStorageSettingsClearsTheCredentialForTheAmbientOne(t *testing.T) {
	client, pg, operator := newStorageClient(t, &recordingTester{checks: passingChecks()})

	if _, err := updateStorageSettings(t, client, operator, storageUpdateRequest(0)); err != nil {
		t.Fatalf("UpdatePlatformStorageSettings: %v", err)
	}

	cleared := storageUpdateRequest(1)
	cleared.AccessKeyId = ""
	cleared.SecretAccessKeyUpdateMode = publirasplatformv1.SecretUpdateMode_SECRET_UPDATE_MODE_CLEAR
	cleared.SecretAccessKey = ""
	saved, err := updateStorageSettings(t, client, operator, cleared)
	if err != nil {
		t.Fatalf("UpdatePlatformStorageSettings(cleared credential): %v", err)
	}
	if saved.GetAccessKeyId() != "" || saved.GetHasSecretAccessKey() {
		t.Fatalf("saved = %+v, want no credential of its own", saved)
	}
	if got := storedSecretCiphertext(t, pg); got != "" {
		t.Fatalf("the row still holds a secret access key (%q)", got)
	}
}

// Half a credential cannot sign and says nothing about who would: the save is
// refused rather than stored as a configuration nothing can use.
func TestDBUpdatePlatformStorageSettingsRefusesHalfACredential(t *testing.T) {
	client, _, operator := newStorageClient(t, &recordingTester{checks: passingChecks()})

	for _, tc := range []struct {
		name  string
		apply func(*publirasplatformv1.UpdatePlatformStorageSettingsRequest)
	}{
		{
			name: "an access key id with no secret",
			apply: func(req *publirasplatformv1.UpdatePlatformStorageSettingsRequest) {
				req.SecretAccessKeyUpdateMode = publirasplatformv1.SecretUpdateMode_SECRET_UPDATE_MODE_CLEAR
				req.SecretAccessKey = ""
			},
		},
		{
			name: "a secret with no access key id",
			apply: func(req *publirasplatformv1.UpdatePlatformStorageSettingsRequest) {
				req.AccessKeyId = ""
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := storageUpdateRequest(0)
			tc.apply(req)
			_, err := updateStorageSettings(t, client, operator, req)
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("UpdatePlatformStorageSettings code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
			}
		})
	}
}

// A save states the revision it was derived from, so a second session's change
// cannot be rolled back by a form that was read before it.
func TestDBUpdatePlatformStorageSettingsRefusesAStaleRevision(t *testing.T) {
	client, _, operator := newStorageClient(t, &recordingTester{checks: passingChecks()})

	if _, err := updateStorageSettings(t, client, operator, storageUpdateRequest(0)); err != nil {
		t.Fatalf("UpdatePlatformStorageSettings: %v", err)
	}

	stale := storageUpdateRequest(0)
	stale.Bucket = "publira-objects-3"
	_, err := updateStorageSettings(t, client, operator, stale)
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("UpdatePlatformStorageSettings code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}
	if got := getStorageSettings(t, client, operator); got.GetBucket() != "publira-objects" {
		t.Fatalf("bucket = %q, want the saved one", got.GetBucket())
	}
}

// The audit entry commits with the configuration it records, so a recorder that
// drops entries cannot leave a change to where every stored object lives
// unrecorded.
func TestDBUpdatePlatformStorageSettingsAuditsInTheSameTransaction(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	db := pg.OpenPlatformDB(t)
	api := newAPI(db, dbmodels.New(db), slog.Default(), storageTestEncryptor(t), nil, testutil.TokenManager(), droppingRecorder{}, openMailGuard(), &recordingTester{checks: passingChecks()})
	ts := httptest.NewServer(handlerFromServer(api.server))
	t.Cleanup(ts.Close)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")
	client := publirasplatformv1connect.NewPlatformStorageSettingsServiceClient(ts.Client(), ts.URL)

	if _, err := updateStorageSettings(t, client, operator, storageUpdateRequest(0)); err != nil {
		t.Fatalf("UpdatePlatformStorageSettings: %v", err)
	}
	if got := countRows(t, pg, `SELECT COUNT(*) FROM platform_audit_logs WHERE action = 'platform_storage_settings_updated'`); got != 1 {
		t.Fatalf("platform_storage_settings_updated audit rows = %d, want 1", got)
	}
}

// An operator testing a saved configuration hands over no credential, so the
// stored one is decrypted for the test and for nothing else.
func TestDBTestPlatformStorageConnectionSignsWithTheStoredSecret(t *testing.T) {
	tester := &recordingTester{checks: passingChecks()}
	client, pg, operator := newStorageClient(t, tester)

	if _, err := updateStorageSettings(t, client, operator, storageUpdateRequest(0)); err != nil {
		t.Fatalf("UpdatePlatformStorageSettings: %v", err)
	}

	resp, err := client.TestPlatformStorageConnection(context.Background(), authedStorageRequest(operator, &publirasplatformv1.TestPlatformStorageConnectionRequest{
		Bucket:                    "publira-objects",
		Region:                    "ap-northeast-1",
		Endpoint:                  "https://s3.example.com",
		ForcePathStyle:            true,
		AccessKeyId:               "AKIAEXAMPLE",
		SecretAccessKeyUpdateMode: publirasplatformv1.SecretUpdateMode_SECRET_UPDATE_MODE_UNCHANGED,
	}))
	if err != nil {
		t.Fatalf("TestPlatformStorageConnection: %v", err)
	}
	if len(resp.Msg.GetChecks()) != 4 {
		t.Fatalf("checks = %d, want one per operation", len(resp.Msg.GetChecks()))
	}
	for _, check := range resp.Msg.GetChecks() {
		if !check.GetSucceeded() {
			t.Fatalf("operation %v was reported as refused with %q", check.GetOperation(), check.GetReason())
		}
	}

	settings, credentials, calls := tester.snapshot()
	if calls != 1 {
		t.Fatalf("the tester was called %d times, want once", calls)
	}
	if settings.Bucket != "publira-objects" || !settings.ForcePathStyle {
		t.Fatalf("the tester was given %+v, want the configuration the request stated", settings)
	}
	if credentials.SecretAccessKey != "the-secret-access-key" {
		t.Fatal("the tester was not given the stored secret access key")
	}
	if got := countRows(t, pg, `SELECT COUNT(*) FROM platform_audit_logs WHERE action = 'platform_storage_connection_tested' AND outcome = 'success'`); got != 1 {
		t.Fatalf("successful test audit rows = %d, want 1", got)
	}
}

// A store that refused an operation is an answer rather than a failed call: the
// operator is told which one, and the audit entry names the same reason.
func TestDBTestPlatformStorageConnectionReportsARefusedOperation(t *testing.T) {
	tester := &recordingTester{checks: []storagesettings.Check{
		{Operation: storagesettings.OperationPutObject},
		{Operation: storagesettings.OperationGetObject, Reason: rpcerrors.ReasonStorageTestPermission},
		{Operation: storagesettings.OperationListObjects},
		{Operation: storagesettings.OperationDeleteObject},
	}}
	client, pg, operator := newStorageClient(t, tester)

	resp, err := client.TestPlatformStorageConnection(context.Background(), authedStorageRequest(operator, &publirasplatformv1.TestPlatformStorageConnectionRequest{
		Bucket: "publira-objects",
		Region: "ap-northeast-1",
	}))
	if err != nil {
		t.Fatalf("TestPlatformStorageConnection: %v", err)
	}
	checks := resp.Msg.GetChecks()
	if len(checks) != 4 || checks[1].GetSucceeded() || checks[1].GetReason() != rpcerrors.ReasonStorageTestPermission {
		t.Fatalf("checks = %+v, want the read reported as refused", checks)
	}

	if got := countRows(
		t,
		pg,
		`SELECT COUNT(*) FROM platform_audit_logs WHERE action = 'platform_storage_connection_tested' AND outcome = 'failure' AND reason = $1`,
		rpcerrors.ReasonStorageTestPermission,
	); got != 1 {
		t.Fatalf("failed test audit rows = %d, want 1", got)
	}
}

// An unconfigured platform still has a form to test from, and the ambient
// credential is what an installation on an instance role tests with.
func TestDBTestPlatformStorageConnectionRunsWithoutAStoredCredential(t *testing.T) {
	tester := &recordingTester{checks: passingChecks()}
	client, _, operator := newStorageClient(t, tester)

	if _, err := client.TestPlatformStorageConnection(context.Background(), authedStorageRequest(operator, &publirasplatformv1.TestPlatformStorageConnectionRequest{
		Bucket: "publira-objects",
		Region: "ap-northeast-1",
	})); err != nil {
		t.Fatalf("TestPlatformStorageConnection: %v", err)
	}

	_, credentials, _ := tester.snapshot()
	if !credentials.Ambient() {
		t.Fatal("the tester was given a credential, want the ambient one")
	}
}
