package platformapi

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	publirasplatformv1 "github.com/publira/publira/server/gen/publira/platform/v1"
	publirasplatformv1connect "github.com/publira/publira/server/gen/publira/platform/v1/publirasplatformv1connect"
	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/testutil"
)

func TestDBLoginIssuesTokenAcceptedByAuthenticatedRPC(t *testing.T) {
	ts, operator := newDBIntegrationTestServer(t)
	authClient := publirasplatformv1connect.NewPlatformAuthServiceClient(ts.Client(), ts.URL)
	tenantClient := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)

	loginResp, err := authClient.Login(context.Background(), connect.NewRequest(&publirasplatformv1.PlatformAuthServiceLoginRequest{
		Email:    operator.Email,
		Password: testutil.SeededPassword,
	}))
	if err != nil {
		t.Fatalf("Login: %v", err)
	}
	if loginResp.Msg.User.PublicId != operator.PublicID {
		t.Fatalf("login public_id = %q, want %q", loginResp.Msg.User.PublicId, operator.PublicID)
	}
	if loginResp.Msg.User.Role != auth.RolePlatformOperator {
		t.Fatalf("login role = %q, want %s", loginResp.Msg.User.Role, auth.RolePlatformOperator)
	}
	if loginResp.Msg.AccessToken.GetToken() == "" {
		t.Fatal("login access_token is empty")
	}

	if _, err := tenantClient.ListTenants(
		context.Background(),
		newDBBearerRequest(loginResp.Msg.AccessToken.Token, publirasplatformv1.ListTenantsRequest{}),
	); err != nil {
		t.Fatalf("ListTenants with the login token: %v", err)
	}
}

func TestDBLoginRejectsWrongPasswordAndUnknownEmail(t *testing.T) {
	ts, operator := newDBIntegrationTestServer(t)
	authClient := publirasplatformv1connect.NewPlatformAuthServiceClient(ts.Client(), ts.URL)

	cases := []struct {
		name     string
		email    string
		password string
	}{
		{"wrong_password", operator.Email, "not-the-password"},
		{"unknown_email", "missing@example.com", testutil.SeededPassword},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := authClient.Login(context.Background(), connect.NewRequest(&publirasplatformv1.PlatformAuthServiceLoginRequest{
				Email:    tc.email,
				Password: tc.password,
			}))
			if connect.CodeOf(err) != connect.CodeUnauthenticated {
				t.Fatalf("Login code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
			}
		})
	}
}

// Suspending an operator has to cut both future logins and tokens already handed
// out; the latter relies on the credentials_version bump written in the same
// transaction as the status change.
func TestDBSuspendOperatorRevokesLoginAndIssuedToken(t *testing.T) {
	ts, pg, superAdmin := newDBIntegrationSuperAdminServer(t)
	target := pg.SeedPlatformOperator(t, "PLATUSER001", "operator@example.com", "Platform Operator")
	authClient := publirasplatformv1connect.NewPlatformAuthServiceClient(ts.Client(), ts.URL)
	operatorClient := publirasplatformv1connect.NewPlatformOperatorServiceClient(ts.Client(), ts.URL)

	loginResp, err := authClient.Login(context.Background(), connect.NewRequest(&publirasplatformv1.PlatformAuthServiceLoginRequest{
		Email:    target.Email,
		Password: testutil.SeededPassword,
	}))
	if err != nil {
		t.Fatalf("Login before suspension: %v", err)
	}
	issuedToken := loginResp.Msg.AccessToken.Token

	suspendResp, err := operatorClient.SuspendOperator(context.Background(), newDBAuthedRequest(superAdmin, publirasplatformv1.SuspendOperatorRequest{
		PublicId: target.PublicID,
	}))
	if err != nil {
		t.Fatalf("SuspendOperator: %v", err)
	}
	if suspendResp.Msg.Operator.Status != userStatusSuspended {
		t.Fatalf("status after suspend = %q, want %s", suspendResp.Msg.Operator.Status, userStatusSuspended)
	}

	suspended := platformUserByPublicID(t, pg, target.PublicID)
	if suspended.CredentialsVersion <= target.CredentialsVersion {
		t.Fatalf("credentials_version = %d, want a bump from %d", suspended.CredentialsVersion, target.CredentialsVersion)
	}

	_, err = authClient.GetMe(context.Background(), newDBBearerRequest(issuedToken, publirasplatformv1.PlatformAuthServiceGetMeRequest{}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("GetMe with the pre-suspension token code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}

	_, err = authClient.Login(context.Background(), connect.NewRequest(&publirasplatformv1.PlatformAuthServiceLoginRequest{
		Email:    target.Email,
		Password: testutil.SeededPassword,
	}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("Login while suspended code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}
}

// A token minted against an older credentials_version must stop working, which is
// what makes a password reset terminate the sessions it was meant to terminate.
func TestDBPasswordResetChangesPasswordAndRevokesTokens(t *testing.T) {
	ts, pg, mailer := newDBIntegrationEnvWithMailer(t)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "operator@example.com", "Platform Operator")
	authClient := publirasplatformv1connect.NewPlatformAuthServiceClient(ts.Client(), ts.URL)

	loginResp, err := authClient.Login(context.Background(), connect.NewRequest(&publirasplatformv1.PlatformAuthServiceLoginRequest{
		Email:    operator.Email,
		Password: testutil.SeededPassword,
	}))
	if err != nil {
		t.Fatalf("Login before reset: %v", err)
	}
	issuedToken := loginResp.Msg.AccessToken.Token

	// Two requests in a row: only the newest token may survive, because the older
	// rows are deleted before the new one is inserted.
	for attempt := range 2 {
		if _, err := authClient.RequestPasswordReset(context.Background(), connect.NewRequest(&publirasplatformv1.PlatformAuthServiceRequestPasswordResetRequest{
			Email: operator.Email,
		})); err != nil {
			t.Fatalf("RequestPasswordReset attempt %d: %v", attempt, err)
		}
	}
	if got := countRows(t, pg, "SELECT COUNT(*) FROM platform_user_password_reset_tokens"); got != 1 {
		t.Fatalf("password reset token rows = %d, want only the newest request to remain", got)
	}

	sent := mailer.sent()
	if len(sent) != 2 {
		t.Fatalf("reset emails = %d, want 2", len(sent))
	}
	staleToken := tokenFromConfirmationEmail(t, sent[0])
	freshToken := tokenFromConfirmationEmail(t, sent[1])

	verify, err := authClient.VerifyPasswordResetToken(context.Background(), connect.NewRequest(&publirasplatformv1.PlatformAuthServiceVerifyPasswordResetTokenRequest{
		Token: staleToken,
	}))
	if err != nil {
		t.Fatalf("VerifyPasswordResetToken stale: %v", err)
	}
	if verify.Msg.Valid {
		t.Fatal("stale reset token is still valid, want it deleted by the second request")
	}

	verify, err = authClient.VerifyPasswordResetToken(context.Background(), connect.NewRequest(&publirasplatformv1.PlatformAuthServiceVerifyPasswordResetTokenRequest{
		Token: freshToken,
	}))
	if err != nil {
		t.Fatalf("VerifyPasswordResetToken fresh: %v", err)
	}
	if !verify.Msg.Valid {
		t.Fatal("newest reset token is invalid, want it usable")
	}

	if _, err := authClient.ConfirmPasswordReset(context.Background(), connect.NewRequest(&publirasplatformv1.PlatformAuthServiceConfirmPasswordResetRequest{
		Token:       freshToken,
		NewPassword: "brand-new-password",
	})); err != nil {
		t.Fatalf("ConfirmPasswordReset: %v", err)
	}

	_, err = authClient.GetMe(context.Background(), newDBBearerRequest(issuedToken, publirasplatformv1.PlatformAuthServiceGetMeRequest{}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("GetMe with the pre-reset token code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}

	_, err = authClient.Login(context.Background(), connect.NewRequest(&publirasplatformv1.PlatformAuthServiceLoginRequest{
		Email:    operator.Email,
		Password: testutil.SeededPassword,
	}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("Login with the old password code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}

	if _, err := authClient.Login(context.Background(), connect.NewRequest(&publirasplatformv1.PlatformAuthServiceLoginRequest{
		Email:    operator.Email,
		Password: "brand-new-password",
	})); err != nil {
		t.Fatalf("Login with the new password: %v", err)
	}

	// The completed token stays in the table, so a replay has to be refused there
	// rather than in memory.
	replay, err := authClient.ConfirmPasswordReset(context.Background(), connect.NewRequest(&publirasplatformv1.PlatformAuthServiceConfirmPasswordResetRequest{
		Token:       freshToken,
		NewPassword: "yet-another-password",
	}))
	if err != nil {
		t.Fatalf("ConfirmPasswordReset replay: %v", err)
	}
	if !replay.Msg.Confirmed {
		t.Fatal("replayed ConfirmPasswordReset confirmed = false, want the completed token reported as confirmed")
	}
	if _, err := authClient.Login(context.Background(), connect.NewRequest(&publirasplatformv1.PlatformAuthServiceLoginRequest{
		Email:    operator.Email,
		Password: "brand-new-password",
	})); err != nil {
		t.Fatalf("Login after the replay: %v", err)
	}
}

func TestDBConfirmPasswordResetRejectsExpiredToken(t *testing.T) {
	ts, pg, mailer := newDBIntegrationEnvWithMailer(t)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "operator@example.com", "Platform Operator")
	authClient := publirasplatformv1connect.NewPlatformAuthServiceClient(ts.Client(), ts.URL)

	if _, err := authClient.RequestPasswordReset(context.Background(), connect.NewRequest(&publirasplatformv1.PlatformAuthServiceRequestPasswordResetRequest{
		Email: operator.Email,
	})); err != nil {
		t.Fatalf("RequestPasswordReset: %v", err)
	}
	token := tokenFromConfirmationEmail(t, mailer.sentTo(t, operator.Email))

	expirePlatformPasswordResetTokens(t, pg)

	_, err := authClient.ConfirmPasswordReset(context.Background(), connect.NewRequest(&publirasplatformv1.PlatformAuthServiceConfirmPasswordResetRequest{
		Token:       token,
		NewPassword: "brand-new-password",
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("ConfirmPasswordReset code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}

	if _, err := authClient.Login(context.Background(), connect.NewRequest(&publirasplatformv1.PlatformAuthServiceLoginRequest{
		Email:    operator.Email,
		Password: testutil.SeededPassword,
	})); err != nil {
		t.Fatalf("Login with the original password: %v", err)
	}
}

// The address is only free until the confirmation completes, so the final update
// has to answer to platform_users_email_key rather than the pre-flight check.
func TestDBConfirmEmailChangeRejectsAddressTakenAfterRequest(t *testing.T) {
	ts, pg, mailer := newDBIntegrationEnvWithMailer(t)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "operator@example.com", "Platform Operator")
	authClient := publirasplatformv1connect.NewPlatformAuthServiceClient(ts.Client(), ts.URL)

	if _, err := authClient.RequestEmailChange(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.PlatformAuthServiceRequestEmailChangeRequest{
		CurrentEmail:    operator.Email,
		NewEmail:        "moved@example.com",
		CurrentPassword: testutil.SeededPassword,
	})); err != nil {
		t.Fatalf("RequestEmailChange: %v", err)
	}

	currentToken := tokenFromConfirmationEmail(t, mailer.sentTo(t, operator.Email))
	newToken := tokenFromConfirmationEmail(t, mailer.sentTo(t, "moved@example.com"))

	// Someone else claims the address between the request and the confirmation.
	seedPlatformUserWithoutRole(t, pg, "PLATOTHER001", "moved@example.com", "Faster Claimant")

	pending, err := authClient.ConfirmEmailChange(context.Background(), connect.NewRequest(&publirasplatformv1.PlatformAuthServiceConfirmEmailChangeRequest{
		Token: currentToken,
	}))
	if err != nil {
		t.Fatalf("ConfirmEmailChange (current email): %v", err)
	}
	if pending.Msg.Changed {
		t.Fatal("changed = true after only one side confirmed, want false")
	}
	if pending.Msg.PendingConfirmationFor != "new_email" {
		t.Fatalf("pending_confirmation_for = %q, want new_email", pending.Msg.PendingConfirmationFor)
	}

	_, err = authClient.ConfirmEmailChange(context.Background(), connect.NewRequest(&publirasplatformv1.PlatformAuthServiceConfirmEmailChangeRequest{
		Token: newToken,
	}))
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("ConfirmEmailChange code = %v, want already_exists (err=%v)", connect.CodeOf(err), err)
	}

	if got := platformUserByPublicID(t, pg, operator.PublicID); got.Email != operator.Email {
		t.Fatalf("email = %q, want the failed change to leave %q", got.Email, operator.Email)
	}
}

func TestDBRequestEmailChangeRejectsExistingAddress(t *testing.T) {
	ts, pg, _ := newDBIntegrationEnvWithMailer(t)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "operator@example.com", "Platform Operator")
	pg.SeedPlatformSuperAdmin(t, "PLATADMIN001", "superadmin@example.com", "Platform Super Admin")
	authClient := publirasplatformv1connect.NewPlatformAuthServiceClient(ts.Client(), ts.URL)

	_, err := authClient.RequestEmailChange(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.PlatformAuthServiceRequestEmailChangeRequest{
		CurrentEmail:    operator.Email,
		NewEmail:        "superadmin@example.com",
		CurrentPassword: testutil.SeededPassword,
	}))
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("RequestEmailChange code = %v, want already_exists (err=%v)", connect.CodeOf(err), err)
	}
	if got := countRows(t, pg, "SELECT COUNT(*) FROM platform_user_email_change_tokens"); got != 0 {
		t.Fatalf("email change token rows = %d, want the rejected request to store none", got)
	}
}

// Password reset mail cannot be sent without SMTP settings, and a request that
// could not be delivered must not leave a usable token behind.
func TestDBRequestPasswordResetWithoutSMTPLeavesNoToken(t *testing.T) {
	ts, pg := newDBIntegrationEnv(t)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "operator@example.com", "Platform Operator")
	authClient := publirasplatformv1connect.NewPlatformAuthServiceClient(ts.Client(), ts.URL)

	_, err := authClient.RequestPasswordReset(context.Background(), connect.NewRequest(&publirasplatformv1.PlatformAuthServiceRequestPasswordResetRequest{
		Email: operator.Email,
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("RequestPasswordReset code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}
	if got := countRows(t, pg, "SELECT COUNT(*) FROM platform_user_password_reset_tokens"); got != 0 {
		t.Fatalf("password reset token rows = %d, want the undelivered request to clean up", got)
	}
}

// An unknown address is answered the same way as a known one, so the endpoint
// cannot be used to enumerate operators.
func TestDBRequestPasswordResetHidesUnknownAddress(t *testing.T) {
	ts, pg, mailer := newDBIntegrationEnvWithMailer(t)
	pg.SeedPlatformOperator(t, "PLATUSER001", "operator@example.com", "Platform Operator")
	authClient := publirasplatformv1connect.NewPlatformAuthServiceClient(ts.Client(), ts.URL)

	resp, err := authClient.RequestPasswordReset(context.Background(), connect.NewRequest(&publirasplatformv1.PlatformAuthServiceRequestPasswordResetRequest{
		Email: "nobody@example.com",
	}))
	if err != nil {
		t.Fatalf("RequestPasswordReset: %v", err)
	}
	if !resp.Msg.Requested {
		t.Fatal("requested = false for an unknown address, want true")
	}
	if got := countRows(t, pg, "SELECT COUNT(*) FROM platform_user_password_reset_tokens"); got != 0 {
		t.Fatalf("password reset token rows = %d, want 0", got)
	}
	if sent := mailer.sent(); len(sent) != 0 {
		t.Fatalf("emails sent = %d, want none for an unknown address", len(sent))
	}
}

func expirePlatformPasswordResetTokens(t *testing.T, pg *testutil.PostgresEnv) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := pg.DB.ExecContext(ctx, `
		UPDATE platform_user_password_reset_tokens
		SET expires_at = NOW() - INTERVAL '1 minute'
	`); err != nil {
		t.Fatalf("expire password reset tokens: %v", err)
	}
}
