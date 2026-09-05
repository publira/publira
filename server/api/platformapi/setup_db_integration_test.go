package platformapi

import (
	"context"
	"testing"

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
