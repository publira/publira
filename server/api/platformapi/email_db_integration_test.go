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
	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/testutil"
)

func newEmailSettingsClient(t *testing.T) (
	publirasplatformv1connect.PlatformEmailSettingsServiceClient,
	*testutil.PostgresEnv,
	testutil.PlatformOperator,
	*secretcrypto.Manager,
) {
	t.Helper()

	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	db := pg.OpenPlatformDB(t)

	encryptor := storageTestEncryptor(t)
	api := newAPI(db, dbmodels.New(db), slog.Default(), encryptor, nil, testutil.TokenManager(), nil, openMailGuard(), nil)
	ts := httptest.NewServer(handlerFromServer(api.server))
	t.Cleanup(ts.Close)

	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")
	return publirasplatformv1connect.NewPlatformEmailSettingsServiceClient(ts.Client(), ts.URL), pg, operator, encryptor
}

// storedSMTPRow is every column an operator's save writes, read on the
// superuser connection so an assertion sees the ciphertext the API never
// returns.
type storedSMTPRow struct {
	host, username, passwordEncrypted, encryption, fromAddress, replyTo string
	port                                                                int32
	revision                                                            int64
	updatedAt                                                           time.Time
}

func readStoredSMTPRow(t *testing.T, pg *testutil.PostgresEnv) storedSMTPRow {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var row storedSMTPRow
	if err := pg.DB.QueryRowContext(ctx, `
		SELECT host, port, username, password_encrypted, encryption, from_address,
		       COALESCE(reply_to, ''), revision, updated_at
		FROM platform_smtp_config`).Scan(
		&row.host, &row.port, &row.username, &row.passwordEncrypted, &row.encryption,
		&row.fromAddress, &row.replyTo, &row.revision, &row.updatedAt,
	); err != nil {
		t.Fatalf("read platform_smtp_config: %v", err)
	}
	return row
}

func decryptStoredPassword(t *testing.T, encryptor *secretcrypto.Manager, row storedSMTPRow) string {
	t.Helper()
	password, err := encryptor.DecryptString(row.passwordEncrypted)
	if err != nil {
		t.Fatalf("DecryptString: %v", err)
	}
	return password
}

func updateEmailSettings(
	ctx context.Context,
	client publirasplatformv1connect.PlatformEmailSettingsServiceClient,
	operator testutil.PlatformOperator,
	req *publirasplatformv1.UpdatePlatformEmailSettingsRequest,
) (*publirasplatformv1.PlatformEmailSettings, error) {
	resp, err := client.UpdatePlatformEmailSettings(ctx, authedStorageRequest(operator, req))
	if err != nil {
		return nil, err
	}
	return resp.Msg.GetSettings(), nil
}

// seedEmailSettings saves a first configuration and answers the revision a
// session reading the screen afterwards would hold.
func seedEmailSettings(
	t *testing.T,
	client publirasplatformv1connect.PlatformEmailSettingsServiceClient,
	operator testutil.PlatformOperator,
) int64 {
	t.Helper()

	req := emailUpdateRequest(0)
	req.PasswordUpdateMode = publirasplatformv1.SecretUpdateMode_SECRET_UPDATE_MODE_REPLACE
	req.Password = "first-password"
	saved, err := updateEmailSettings(context.Background(), client, operator, req)
	if err != nil {
		t.Fatalf("UpdatePlatformEmailSettings (seed): %v", err)
	}
	resp, err := client.GetPlatformEmailSettings(context.Background(), authedStorageRequest(operator, &publirasplatformv1.GetPlatformEmailSettingsRequest{}))
	if err != nil {
		t.Fatalf("GetPlatformEmailSettings: %v", err)
	}
	if resp.Msg.GetSettings().GetRevision() != saved.GetRevision() {
		t.Fatalf("read revision = %d, want the saved %d", resp.Msg.GetSettings().GetRevision(), saved.GetRevision())
	}
	return saved.GetRevision()
}

// The window this closes: a session that opened the screen before another one
// saved a new password states `unchanged` for it, and would otherwise write the
// ciphertext it read back over the new one.
func TestDBUpdatePlatformEmailSettingsRejectsAStaleRevision(t *testing.T) {
	client, pg, operator, encryptor := newEmailSettingsClient(t)

	// Both sessions read this revision.
	stale := seedEmailSettings(t, client, operator)

	// Session B saves a new password and moves the row on.
	passwordSave := emailUpdateRequest(stale)
	passwordSave.PasswordUpdateMode = publirasplatformv1.SecretUpdateMode_SECRET_UPDATE_MODE_REPLACE
	passwordSave.Password = "second-password"
	if _, err := updateEmailSettings(context.Background(), client, operator, passwordSave); err != nil {
		t.Fatalf("UpdatePlatformEmailSettings (password): %v", err)
	}
	before := readStoredSMTPRow(t, pg)

	// Session A saves the host it changed and leaves the password as it read it.
	hostSave := emailUpdateRequest(stale)
	hostSave.Host = "smtp.other.example"
	_, err := updateEmailSettings(context.Background(), client, operator, hostSave)
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("UpdatePlatformEmailSettings (host) code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}

	// No column moved: not the host the refused save wanted, and not the
	// password B saved.
	after := readStoredSMTPRow(t, pg)
	if after != before {
		t.Fatalf("platform_smtp_config = %+v, want it untouched at %+v", after, before)
	}
	if got := decryptStoredPassword(t, encryptor, after); got != "second-password" {
		t.Fatalf("stored password = %q, want second-password", got)
	}
	if after.revision != stale+1 {
		t.Fatalf("revision = %d, want %d", after.revision, stale+1)
	}
}

// Two saves from the same revision at the same time. The lock serializes them,
// so exactly one applies and the other is told the row moved.
func TestDBUpdatePlatformEmailSettingsConcurrentSavesOneWins(t *testing.T) {
	client, pg, operator, encryptor := newEmailSettingsClient(t)

	shared := seedEmailSettings(t, client, operator)

	// One session saves a new password, the other a new host that keeps the
	// password it read.
	passwordSave := emailUpdateRequest(shared)
	passwordSave.PasswordUpdateMode = publirasplatformv1.SecretUpdateMode_SECRET_UPDATE_MODE_REPLACE
	passwordSave.Password = "second-password"
	hostSave := emailUpdateRequest(shared)
	hostSave.Host = "smtp.other.example"

	type outcome struct {
		req      *publirasplatformv1.UpdatePlatformEmailSettingsRequest
		settings *publirasplatformv1.PlatformEmailSettings
		err      error
	}
	outcomes := make(chan outcome, 2)
	// One request waits on the other's row lock, so both carry a deadline: a
	// lock that is never released fails the test instead of hanging the suite.
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	var wg sync.WaitGroup
	for _, req := range []*publirasplatformv1.UpdatePlatformEmailSettingsRequest{passwordSave, hostSave} {
		wg.Add(1)
		go func(req *publirasplatformv1.UpdatePlatformEmailSettingsRequest) {
			defer wg.Done()
			settings, err := updateEmailSettings(ctx, client, operator, req)
			outcomes <- outcome{req: req, settings: settings, err: err}
		}(req)
	}
	wg.Wait()
	close(outcomes)

	var winner *outcome
	failures := 0
	for result := range outcomes {
		if result.err == nil {
			if winner != nil {
				t.Fatal("both saves succeeded, want exactly one to apply")
			}
			winner = &result
			continue
		}
		if connect.CodeOf(result.err) != connect.CodeFailedPrecondition {
			t.Fatalf("losing UpdatePlatformEmailSettings code = %v, want failed_precondition (err=%v)", connect.CodeOf(result.err), result.err)
		}
		failures++
	}
	if winner == nil {
		t.Fatal("both saves failed, want exactly one to apply")
	}
	if failures != 1 {
		t.Fatalf("failed_precondition count = %d, want 1", failures)
	}

	// The stored row is the winner's, whole: the loser wrote none of its
	// columns, the password least of all.
	stored := readStoredSMTPRow(t, pg)
	if stored.revision != shared+1 || stored.revision != winner.settings.GetRevision() {
		t.Fatalf("revision = %d, want %d", stored.revision, shared+1)
	}
	if stored.host != winner.req.GetHost() {
		t.Fatalf("host = %q, want the winner's %q", stored.host, winner.req.GetHost())
	}
	wantPassword := "first-password"
	if winner.req == passwordSave {
		wantPassword = "second-password"
	}
	if got := decryptStoredPassword(t, encryptor, stored); got != wantPassword {
		t.Fatalf("stored password = %q, want the winner's %q", got, wantPassword)
	}
}
