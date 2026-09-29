package platformapi

import (
	"context"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/auth"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	publirasplatformv1connect "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1/publirasplatformv1connect"
	"github.com/publira/publira/server/internal/testutil"
)

func TestDBInitialSetupCreatesLoginableSuperAdmin(t *testing.T) {
	ts, _ := newDBIntegrationEnv(t)
	setup := publirasplatformv1connect.NewPlatformSetupServiceClient(ts.Client(), ts.URL)
	authClient := publirasplatformv1connect.NewPlatformAuthServiceClient(ts.Client(), ts.URL)

	status, err := setup.CheckSetupStatus(context.Background(), connect.NewRequest(&publirasplatformv1.CheckSetupStatusRequest{}))
	if err != nil {
		t.Fatalf("CheckSetupStatus: %v", err)
	}
	if status.Msg.SetupCompleted {
		t.Fatal("setup_completed = true on an empty database, want false")
	}

	if _, err := setup.CreateInitialUser(context.Background(), connect.NewRequest(&publirasplatformv1.CreateInitialUserRequest{
		Name:          "Initial Admin",
		Email:         "initial-admin@example.com",
		Password:      "initial-admin-password",
		DefaultLocale: "en",
	})); err != nil {
		t.Fatalf("CreateInitialUser: %v", err)
	}

	status, err = setup.CheckSetupStatus(context.Background(), connect.NewRequest(&publirasplatformv1.CheckSetupStatusRequest{}))
	if err != nil {
		t.Fatalf("CheckSetupStatus after setup: %v", err)
	}
	if !status.Msg.SetupCompleted {
		t.Fatal("setup_completed = false after the initial user was created, want true")
	}

	// The role row has to be committed with the user, otherwise the account exists
	// but cannot authenticate.
	loginResp, err := authClient.Login(context.Background(), connect.NewRequest(&publirasplatformv1.PlatformAuthServiceLoginRequest{
		Email:    "initial-admin@example.com",
		Password: "initial-admin-password",
	}))
	if err != nil {
		t.Fatalf("Login as the initial user: %v", err)
	}
	if loginResp.Msg.User.Role != auth.RolePlatformSuperAdmin {
		t.Fatalf("role = %q, want %s", loginResp.Msg.User.Role, auth.RolePlatformSuperAdmin)
	}

	me, err := authClient.GetMe(
		context.Background(),
		newDBBearerRequest(loginResp.Msg.AccessToken.Token, publirasplatformv1.PlatformAuthServiceGetMeRequest{}),
	)
	if err != nil {
		t.Fatalf("GetMe with the login token: %v", err)
	}
	if me.Msg.User.PublicId != loginResp.Msg.User.PublicId {
		t.Fatalf("GetMe public_id = %q, want %q", me.Msg.User.PublicId, loginResp.Msg.User.PublicId)
	}
}

func TestDBCreateInitialUserRejectsSecondSetup(t *testing.T) {
	ts, pg := newDBIntegrationEnv(t)
	pg.SeedPlatformSuperAdmin(t, "PLATADMIN001", "superadmin@example.com", "Platform Super Admin")
	setup := publirasplatformv1connect.NewPlatformSetupServiceClient(ts.Client(), ts.URL)

	_, err := setup.CreateInitialUser(context.Background(), connect.NewRequest(&publirasplatformv1.CreateInitialUserRequest{
		Name:          "Second Admin",
		Email:         "second-admin@example.com",
		Password:      "second-admin-password",
		DefaultLocale: "en",
	}))
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("CreateInitialUser code = %v, want already_exists (err=%v)", connect.CodeOf(err), err)
	}

	if got := countRows(t, pg, "SELECT COUNT(*) FROM platform_users"); got != 1 {
		t.Fatalf("platform_users rows = %d, want the rejected setup to leave 1", got)
	}
}

// Setup completion is decided by the platform_users count, so even a row that
// carries no platform role closes the setup endpoint.
func TestDBCreateInitialUserRejectsWhenRolelessPlatformUserExists(t *testing.T) {
	ts, pg := newDBIntegrationEnv(t)
	setup := publirasplatformv1connect.NewPlatformSetupServiceClient(ts.Client(), ts.URL)

	seedPlatformUserWithoutRole(t, pg, "PLATNOROLE01", "no-role@example.com", "No Role")

	_, err := setup.CreateInitialUser(context.Background(), connect.NewRequest(&publirasplatformv1.CreateInitialUserRequest{
		Name:          "Initial Admin",
		Email:         "initial-admin@example.com",
		Password:      "initial-admin-password",
		DefaultLocale: "en",
	}))
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("CreateInitialUser code = %v, want already_exists (err=%v)", connect.CodeOf(err), err)
	}

	if got := countRows(t, pg, "SELECT COUNT(*) FROM platform_users"); got != 1 {
		t.Fatalf("platform_users rows = %d, want the rejected setup to add none", got)
	}
	if got := countRows(t, pg, "SELECT COUNT(*) FROM platform_user_roles"); got != 0 {
		t.Fatalf("platform_user_roles rows = %d, want 0", got)
	}
}

// A platform user carrying no platform role cannot be authenticated even though
// the credentials themselves are valid.
func TestDBLoginRejectsPlatformUserWithoutRole(t *testing.T) {
	ts, pg := newDBIntegrationEnv(t)
	seedPlatformUserWithoutRole(t, pg, "PLATNOROLE01", "no-role@example.com", "No Role")
	authClient := publirasplatformv1connect.NewPlatformAuthServiceClient(ts.Client(), ts.URL)

	_, err := authClient.Login(context.Background(), connect.NewRequest(&publirasplatformv1.PlatformAuthServiceLoginRequest{
		Email:    "no-role@example.com",
		Password: testutil.SeededPassword,
	}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("Login code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}
}

// The locale the operator picks on the setup screen is the platform default
// from the moment setup finishes, so the console has a language to render in
// before anyone opens the settings screen.
func TestDBInitialSetupSavesTheChosenDefaultLocale(t *testing.T) {
	ts, pg := newDBIntegrationEnv(t)
	setup := publirasplatformv1connect.NewPlatformSetupServiceClient(ts.Client(), ts.URL)
	authClient := publirasplatformv1connect.NewPlatformAuthServiceClient(ts.Client(), ts.URL)
	settings := publirasplatformv1connect.NewPlatformSettingsServiceClient(ts.Client(), ts.URL)

	if _, err := setup.CreateInitialUser(context.Background(), connect.NewRequest(&publirasplatformv1.CreateInitialUserRequest{
		Name:          "Initial Admin",
		Email:         "initial-admin@example.com",
		Password:      "initial-admin-password",
		DefaultLocale: "en",
	})); err != nil {
		t.Fatalf("CreateInitialUser: %v", err)
	}

	if got := countRows(t, pg, `SELECT COUNT(*) FROM platform_config WHERE default_locale = 'en'`); got != 1 {
		t.Fatalf("platform_config rows with default_locale = en: %d, want 1", got)
	}

	loginResp, err := authClient.Login(context.Background(), connect.NewRequest(&publirasplatformv1.PlatformAuthServiceLoginRequest{
		Email:    "initial-admin@example.com",
		Password: "initial-admin-password",
	}))
	if err != nil {
		t.Fatalf("Login as the initial user: %v", err)
	}

	resp, err := settings.GetPlatformSettings(
		context.Background(),
		newDBBearerRequest(loginResp.Msg.AccessToken.Token, publirasplatformv1.GetPlatformSettingsRequest{}),
	)
	if err != nil {
		t.Fatalf("GetPlatformSettings: %v", err)
	}
	if resp.Msg.Settings.DefaultLocale != "en" {
		t.Fatalf("default_locale = %q, want en", resp.Msg.Settings.DefaultLocale)
	}
}

// An unsupported code is rejected before any write, so a rejected setup leaves
// no administrator and no settings row behind.
func TestDBCreateInitialUserRejectsUnsupportedLocale(t *testing.T) {
	ts, pg := newDBIntegrationEnv(t)
	setup := publirasplatformv1connect.NewPlatformSetupServiceClient(ts.Client(), ts.URL)

	_, err := setup.CreateInitialUser(context.Background(), connect.NewRequest(&publirasplatformv1.CreateInitialUserRequest{
		Name:          "Initial Admin",
		Email:         "initial-admin@example.com",
		Password:      "initial-admin-password",
		DefaultLocale: "fr",
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("CreateInitialUser code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}

	if got := countRows(t, pg, "SELECT COUNT(*) FROM platform_users"); got != 0 {
		t.Fatalf("platform_users rows = %d, want 0", got)
	}
	if got := countRows(t, pg, "SELECT COUNT(*) FROM platform_config"); got != 0 {
		t.Fatalf("platform_config rows = %d, want 0", got)
	}
}

// Two setups that both passed the fast path used to both create an operator,
// and the later one's upsert overwrote the locale the earlier one saved. Holding
// the setup lock from outside makes both reach it before either writes.
func TestDBConcurrentInitialSetupLeavesOneOperator(t *testing.T) {
	ts, pg := newDBIntegrationEnv(t)
	setup := publirasplatformv1connect.NewPlatformSetupServiceClient(ts.Client(), ts.URL)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	holder, err := pg.DB.Conn(ctx)
	if err != nil {
		t.Fatalf("open lock holder connection: %v", err)
	}
	defer holder.Close() //nolint:errcheck
	if _, err := holder.ExecContext(ctx, setupLockQuery("pg_advisory_lock")); err != nil {
		t.Fatalf("take the setup lock: %v", err)
	}

	requests := []*publirasplatformv1.CreateInitialUserRequest{
		{Name: "English Admin", Email: "en-admin@example.com", Password: "en-admin-password", DefaultLocale: "en"},
		{Name: "Japanese Admin", Email: "ja-admin@example.com", Password: "ja-admin-password", DefaultLocale: "ja"},
	}
	errs := make([]error, len(requests))
	var wg sync.WaitGroup
	for i, msg := range requests {
		wg.Go(func() {
			_, errs[i] = setup.CreateInitialUser(ctx, connect.NewRequest(msg))
		})
	}

	for countRows(t, pg, "SELECT COUNT(*) FROM pg_locks WHERE locktype = 'advisory' AND NOT granted") < len(requests) {
		if ctx.Err() != nil {
			t.Fatal("both setups never reached the setup lock")
		}
		time.Sleep(20 * time.Millisecond)
	}
	if _, err := holder.ExecContext(ctx, setupLockQuery("pg_advisory_unlock")); err != nil {
		t.Fatalf("release the setup lock: %v", err)
	}
	wg.Wait()

	winner := -1
	for i, err := range errs {
		switch {
		case err == nil && winner < 0:
			winner = i
		case connect.CodeOf(err) == connect.CodeAlreadyExists:
		default:
			t.Fatalf("CreateInitialUser(%s) = %v, want one success and one already_exists", requests[i].Email, err)
		}
	}
	if winner < 0 {
		t.Fatalf("CreateInitialUser errors = %v, want one success", errs)
	}

	if got := countRows(t, pg, "SELECT COUNT(*) FROM platform_users"); got != 1 {
		t.Fatalf("platform_users rows = %d, want 1", got)
	}
	if got := countRows(t, pg, "SELECT COUNT(*) FROM platform_users WHERE email = $1", requests[winner].Email); got != 1 {
		t.Fatalf("platform_users rows for the winner %s = %d, want 1", requests[winner].Email, got)
	}
	if got := countRows(t, pg, "SELECT COUNT(*) FROM platform_user_roles"); got != 1 {
		t.Fatalf("platform_user_roles rows = %d, want 1", got)
	}
	if got := countRows(t, pg, "SELECT COUNT(*) FROM platform_config"); got != 1 {
		t.Fatalf("platform_config rows = %d, want 1", got)
	}
	if got := countRows(t, pg, "SELECT COUNT(*) FROM platform_config WHERE default_locale = $1", requests[winner].DefaultLocale); got != 1 {
		t.Fatalf("platform_config rows with the winner's locale %s = %d, want 1", requests[winner].DefaultLocale, got)
	}
}

// setupLockQuery calls fn on the key LockPlatformInitialSetup takes.
func setupLockQuery(fn string) string {
	return "SELECT " + fn + "(hashtextextended('platform_initial_setup', 0))"
}

// A settings row can outlive every operator, so setup completes over it: the
// chosen locale replaces the saved one and the saved time zone is kept.
func TestDBInitialSetupOverAnOrphanedSettingsRow(t *testing.T) {
	ts, pg := newDBIntegrationEnv(t)
	setup := publirasplatformv1connect.NewPlatformSetupServiceClient(ts.Client(), ts.URL)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO platform_config (singleton, default_timezone, default_locale)
		VALUES (TRUE, 'Asia/Tokyo', 'ja')
	`); err != nil {
		t.Fatalf("seed platform_config: %v", err)
	}

	if _, err := setup.CreateInitialUser(ctx, connect.NewRequest(&publirasplatformv1.CreateInitialUserRequest{
		Name:          "Initial Admin",
		Email:         "initial-admin@example.com",
		Password:      "initial-admin-password",
		DefaultLocale: "en",
	})); err != nil {
		t.Fatalf("CreateInitialUser: %v", err)
	}

	if got := countRows(t, pg, "SELECT COUNT(*) FROM platform_users"); got != 1 {
		t.Fatalf("platform_users rows = %d, want 1", got)
	}
	if got := countRows(t, pg, `
		SELECT COUNT(*) FROM platform_config
		WHERE default_locale = 'en' AND default_timezone = 'Asia/Tokyo'
	`); got != 1 {
		t.Fatal("platform_config does not hold locale en with the saved time zone Asia/Tokyo")
	}
}
