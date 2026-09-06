package publicapi

import (
	"context"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/genproto/googleapis/rpc/errdetails"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// Member sign-in is decided by three columns the sqlmock tests can only assert
// about indirectly: the tenant a users row belongs to, its status and
// email_verified_at, and the credentials_version an issued token was minted
// against. These cases drive them against a real database.

func TestDBLoginIssuesTokenAcceptedByGetMe(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	user := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	client := env.authClient()

	login, err := client.Login(context.Background(), connect.NewRequest(&publirav1.LoginRequest{
		Tenant:   tenantContext(tenant),
		Email:    user.Email,
		Password: testutil.SeededPassword,
	}))
	if err != nil {
		t.Fatalf("Login: %v", err)
	}
	if login.Msg.User.PublicId != user.PublicID {
		t.Fatalf("login public_id = %q, want %q", login.Msg.User.PublicId, user.PublicID)
	}
	if login.Msg.AccessToken.GetToken() == "" {
		t.Fatal("login access_token is empty")
	}

	me, err := client.GetMe(context.Background(), newBearerRequest(
		&publirav1.GetMeRequest{Tenant: tenantContext(tenant)},
		login.Msg.AccessToken.Token,
	))
	if err != nil {
		t.Fatalf("GetMe with the login token: %v", err)
	}
	if me.Msg.User.PublicId != user.PublicID {
		t.Fatalf("GetMe public_id = %q, want %q", me.Msg.User.PublicId, user.PublicID)
	}
}

func TestDBLoginRejectsWrongPasswordAndUnknownEmail(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	user := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	client := env.authClient()

	cases := []struct {
		name     string
		email    string
		password string
	}{
		{"wrong_password", user.Email, "not-the-password"},
		{"unknown_email", "nobody@tenant-a.example.com", testutil.SeededPassword},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := client.Login(context.Background(), connect.NewRequest(&publirav1.LoginRequest{
				Tenant:   tenantContext(tenant),
				Email:    tc.email,
				Password: tc.password,
			}))
			if connect.CodeOf(err) != connect.CodeUnauthenticated {
				t.Fatalf("Login code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
			}
		})
	}
}

// Signup leaves the account inactive until the address is confirmed, and the
// password alone must not get past that.
func TestDBLoginRejectsUnverifiedAccount(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	pending := env.PG.SeedUnverifiedEndUser(t, tenant.ID, "ENDUSERA0002", "pending@tenant-a.example.com", "Pending Member")

	_, err := env.authClient().Login(context.Background(), connect.NewRequest(&publirav1.LoginRequest{
		Tenant:   tenantContext(tenant),
		Email:    pending.Email,
		Password: testutil.SeededPassword,
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("Login code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}
}

// Two storefronts share one users table, so the credentials of one tenant's
// member must be worthless at another tenant's login form.
func TestDBLoginRejectsMemberOfAnotherTenant(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)
	theirMember := env.PG.SeedEndUser(t, second.ID, "ENDUSERB0001", "member@tenant-b.example.com", "Tenant B Member")

	_, err := env.authClient().Login(context.Background(), connect.NewRequest(&publirav1.LoginRequest{
		Tenant:   tenantContext(first),
		Email:    theirMember.Email,
		Password: testutil.SeededPassword,
	}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("Login across tenants code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}
}

// A password reset or an account deletion bumps credentials_version, which is
// what makes the tokens already handed out stop working.
func TestDBAccessTokenStopsWorkingAfterCredentialsVersionBump(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	user := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	client := env.authClient()

	login, err := client.Login(context.Background(), connect.NewRequest(&publirav1.LoginRequest{
		Tenant:   tenantContext(tenant),
		Email:    user.Email,
		Password: testutil.SeededPassword,
	}))
	if err != nil {
		t.Fatalf("Login: %v", err)
	}
	issuedToken := login.Msg.AccessToken.Token

	env.bumpCredentialsVersion(t, user.ID)

	_, err = client.GetMe(context.Background(), newBearerRequest(
		&publirav1.GetMeRequest{Tenant: tenantContext(tenant)},
		issuedToken,
	))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("GetMe with the pre-bump token code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}

	// The password itself is untouched, so a fresh login must still work and hand
	// back a token minted against the new version.
	relogin, err := client.Login(context.Background(), connect.NewRequest(&publirav1.LoginRequest{
		Tenant:   tenantContext(tenant),
		Email:    user.Email,
		Password: testutil.SeededPassword,
	}))
	if err != nil {
		t.Fatalf("Login after the bump: %v", err)
	}
	if _, err := client.GetMe(context.Background(), newBearerRequest(
		&publirav1.GetMeRequest{Tenant: tenantContext(tenant)},
		relogin.Msg.AccessToken.Token,
	)); err != nil {
		t.Fatalf("GetMe with the reissued token: %v", err)
	}
}

func TestDBAccessTokenStopsWorkingWhenAccountIsSuspended(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	user := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	token := tokenFor(t, tenant, user)
	client := env.authClient()

	if _, err := client.GetMe(context.Background(), newBearerRequest(
		&publirav1.GetMeRequest{Tenant: tenantContext(tenant)},
		token,
	)); err != nil {
		t.Fatalf("GetMe before suspension: %v", err)
	}

	env.suspendUser(t, user.ID)

	_, err := client.GetMe(context.Background(), newBearerRequest(
		&publirav1.GetMeRequest{Tenant: tenantContext(tenant)},
		token,
	))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("GetMe while suspended code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}
}

// The confirmation password on account deletion is form input, not credentials.
// Getting it wrong must not read as "your session ended" — clients turn
// Unauthenticated into a forced re-login, which would log a reader out over a
// typo.
func TestDBDeleteMeRejectsWrongPasswordAsInvalidArgument(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	user := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	token := tokenFor(t, tenant, user)
	client := env.authClient()

	_, err := client.DeleteMe(context.Background(), newBearerRequest(
		&publirav1.DeleteMeRequest{Tenant: tenantContext(tenant), Password: "not-the-password"},
		token,
	))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("DeleteMe with a wrong password code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	assertPublicBadRequestField(t, err, "password")

	// The session is untouched, so the reader can correct the field and retry.
	if _, err := client.GetMe(context.Background(), newBearerRequest(
		&publirav1.GetMeRequest{Tenant: tenantContext(tenant)},
		token,
	)); err != nil {
		t.Fatalf("GetMe after a rejected DeleteMe: %v", err)
	}
}

// A purchase is a commerce record rather than an entitlement: a past day's
// revenue figures are recomputed from the purchases table long after the buyer
// closes their account. Closing it therefore takes the buyer off the row and
// leaves the row where it is.
func TestDBDeleteMeKeepsThePurchasesWithoutTheBuyer(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	buyer := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "buyer@tenant-a.example.com", "Buyer")
	staying := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0002", "reader@tenant-a.example.com", "Reader")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESPUB001", Published: true})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODE00001",
		Price:    300,
		Status:   testutil.EpisodeStatusPublished,
	})
	env.PG.SeedPurchase(t, tenant.ID, buyer.ID, episode.ID, 300)

	if _, err := env.authClient().DeleteMe(context.Background(), newBearerRequest(
		&publirav1.DeleteMeRequest{Tenant: tenantContext(tenant), Password: testutil.SeededPassword},
		tokenFor(t, tenant, buyer),
	)); err != nil {
		t.Fatalf("DeleteMe for a reader who bought an episode: %v", err)
	}

	if count := env.countRows(t,
		"SELECT count(*) FROM purchases WHERE tenant_id = $1 AND episode_id = $2",
		tenant.ID, episode.ID,
	); count != 1 {
		t.Fatalf("purchases of the episode after the delete = %d, want 1", count)
	}
	if count := env.countRows(t,
		"SELECT count(*) FROM purchases WHERE tenant_id = $1 AND user_id IS NOT NULL",
		tenant.ID,
	); count != 0 {
		t.Fatalf("purchases still naming their buyer = %d, want 0", count)
	}

	// The row is in no library now, so the tenant's remaining reader must not
	// find it in theirs.
	library, err := env.purchaseClient().ListMyPurchases(context.Background(), newBearerRequest(
		&publirav1.ListMyPurchasesRequest{Tenant: tenantContext(tenant)},
		tokenFor(t, tenant, staying),
	))
	if err != nil {
		t.Fatalf("ListMyPurchases: %v", err)
	}
	if len(library.Msg.Purchases) != 0 {
		t.Fatalf("purchases in another reader's library = %d, want 0", len(library.Msg.Purchases))
	}
}

func assertPublicBadRequestField(t *testing.T, err error, wantField string) {
	t.Helper()
	rpcError, ok := err.(*connect.Error)
	if !ok {
		t.Fatalf("error type = %T, want *connect.Error", err)
	}
	if len(rpcError.Details()) != 1 {
		t.Fatalf("detail count = %d, want 1", len(rpcError.Details()))
	}
	detail, detailErr := rpcError.Details()[0].Value()
	if detailErr != nil {
		t.Fatalf("detail = %v", detailErr)
	}
	badRequest, ok := detail.(*errdetails.BadRequest)
	if !ok || len(badRequest.FieldViolations) != 1 || badRequest.FieldViolations[0].Field != wantField {
		t.Fatalf("field violations = %#v, want %q", badRequest, wantField)
	}
}

// A valid session at one storefront must not carry over to another, even though
// both are served by the same process and the same signing key.
func TestDBGetMeRejectsTokenMintedForAnotherTenant(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)
	theirMember := env.PG.SeedEndUser(t, second.ID, "ENDUSERB0001", "member@tenant-b.example.com", "Tenant B Member")
	theirToken := tokenFor(t, second, theirMember)

	_, err := env.authClient().GetMe(context.Background(), newBearerRequest(
		&publirav1.GetMeRequest{Tenant: tenantContext(first)},
		theirToken,
	))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("GetMe with another tenant's token code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}
}

// The state of one account, as far as a sign-up for its address may touch it.
type storedAccount struct {
	name               string
	passwordHash       string
	credentialsVersion int32
	verified           bool
}

func readStoredAccount(t *testing.T, env *publicDBEnv, email string) storedAccount {
	t.Helper()

	var account storedAccount
	err := env.PG.DB.QueryRow(`
		SELECT name, password_hash, credentials_version, email_verified_at IS NOT NULL
		FROM users
		WHERE email = $1
	`, email).Scan(&account.name, &account.passwordHash, &account.credentialsVersion, &account.verified)
	if err != nil {
		t.Fatalf("read the account for %s: %v", email, err)
	}
	return account
}

func countRows(t *testing.T, env *publicDBEnv, query string, args ...any) int {
	t.Helper()

	var count int
	if err := env.PG.DB.QueryRow(query, args...).Scan(&count); err != nil {
		t.Fatalf("count rows: %v", err)
	}
	return count
}

// A sign-up must not answer whether the address it names already has an
// account. Both cases end in the same response, and what separates them is the
// mail the outbox carries.
func TestDBCreateUserAnswersARegisteredAddressLikeAFreeOne(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	member := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	before := readStoredAccount(t, env, member.Email)
	client := env.authClient()

	free, err := client.CreateUser(context.Background(), connect.NewRequest(&publirav1.CreateUserRequest{
		Tenant:   tenantContext(tenant),
		Name:     "Newcomer",
		Email:    "newcomer@tenant-a.example.com",
		Password: "newcomer-password",
	}))
	if err != nil {
		t.Fatalf("CreateUser with a free address: %v", err)
	}

	taken, err := client.CreateUser(context.Background(), connect.NewRequest(&publirav1.CreateUserRequest{
		Tenant:   tenantContext(tenant),
		Name:     "Impersonating Signup",
		Email:    member.Email,
		Password: "another-password",
	}))
	if err != nil {
		t.Fatalf("CreateUser with a registered address: %v", err)
	}
	if !taken.Msg.Accepted || taken.Msg.Accepted != free.Msg.Accepted {
		t.Fatalf("accepted = %v for the registered address and %v for the free one, want both true",
			taken.Msg.Accepted, free.Msg.Accepted)
	}

	if count := countRows(t, env, `SELECT count(*) FROM users WHERE email = $1`, member.Email); count != 1 {
		t.Fatalf("accounts for %s = %d, want 1", member.Email, count)
	}
	if after := readStoredAccount(t, env, member.Email); after != before {
		t.Fatalf("account after the sign-up = %+v, want %+v", after, before)
	}
	if count := countRows(t, env,
		`SELECT count(*) FROM user_email_verification_tokens WHERE user_id = $1`, member.ID); count != 0 {
		t.Fatalf("verification tokens for the registered account = %d, want none", count)
	}
}

// The account's owner is the one told what happened, because a sign-up they
// made themselves after forgetting the account would otherwise dead-end.
func TestDBCreateUserMailsTheOwnerOfARegisteredAddress(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	member := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")

	for attempt := range 2 {
		if _, err := env.authClient().CreateUser(context.Background(), connect.NewRequest(&publirav1.CreateUserRequest{
			Tenant:   tenantContext(tenant),
			Name:     "Impersonating Signup",
			Email:    member.Email,
			Password: "another-password",
		})); err != nil {
			t.Fatalf("CreateUser attempt %d: %v", attempt+1, err)
		}
	}

	// One notice per attempt: a reader targeted again has to hear about it,
	// which is why the events are keyed by the attempt and not by the account.
	notices := countRows(t, env, `
		SELECT count(*) FROM outbox_events
		WHERE event_type = 'reader_signup_attempt_notice_email'
		AND payload ->> 'user_id' = $1
	`, member.ID.String())
	if notices != 2 {
		t.Fatalf("queued notices = %d, want 2", notices)
	}
	verifications := countRows(t, env, `
		SELECT count(*) FROM outbox_events WHERE event_type = 'reader_email_verification_email'
	`)
	if verifications != 0 {
		t.Fatalf("queued verification mails = %d, want none", verifications)
	}
}

// seedEmailVerificationToken puts the row a sign-up leaves behind on an account
// the helpers seed without one, so a resend has an earlier link to supersede.
func (e *publicDBEnv) seedEmailVerificationToken(
	t *testing.T,
	tenantID, userID uuid.UUID,
	token string,
	expiresAt time.Time,
) uuid.UUID {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	id, err := uuid.NewV7()
	if err != nil {
		t.Fatalf("generate verification token id: %v", err)
	}
	if _, err := dbmodels.New(e.PG.DB).CreateUserEmailVerificationToken(ctx, dbmodels.CreateUserEmailVerificationTokenParams{
		ID:        id,
		TenantID:  tenantID,
		UserID:    userID,
		TokenHash: auth.HashToken(token),
		ExpiresAt: expiresAt,
	}); err != nil {
		t.Fatalf("CreateUserEmailVerificationToken %s: %v", userID, err)
	}
	return id
}

// A reader whose first link expired asks for another one and gets it. The
// expired row is replaced rather than joined, so the account keeps a single
// live link, and nothing on the account itself is written to.
func TestDBRequestEmailVerificationReplacesAnExpiredLink(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	pending := env.PG.SeedUnverifiedEndUser(t, tenant.ID, "ENDUSERA0001", "pending@tenant-a.example.com", "Pending")
	expired := env.seedEmailVerificationToken(t, tenant.ID, pending.ID, "expired-token", time.Now().Add(-time.Hour))
	before := readStoredAccount(t, env, pending.Email)

	resp, err := env.authClient().RequestEmailVerification(context.Background(), connect.NewRequest(&publirav1.RequestEmailVerificationRequest{
		Tenant: tenantContext(tenant),
		Email:  pending.Email,
	}))
	if err != nil {
		t.Fatalf("RequestEmailVerification: %v", err)
	}
	if !resp.Msg.Requested {
		t.Fatal("requested = false, want true")
	}

	if count := countRows(t, env,
		`SELECT count(*) FROM user_email_verification_tokens WHERE id = $1`, expired); count != 0 {
		t.Fatalf("the expired token still exists (%d rows), want it replaced", count)
	}
	live := countRows(t, env, `
		SELECT count(*) FROM user_email_verification_tokens
		WHERE user_id = $1 AND used_at IS NULL AND expires_at > NOW()
	`, pending.ID)
	if live != 1 {
		t.Fatalf("live verification tokens = %d, want 1", live)
	}
	mails := countRows(t, env, `
		SELECT count(*) FROM outbox_events WHERE event_type = 'reader_email_verification_email'
	`)
	if mails != 1 {
		t.Fatalf("queued verification mails = %d, want 1", mails)
	}
	if after := readStoredAccount(t, env, pending.Email); after != before {
		t.Fatalf("account after the request = %+v, want %+v", after, before)
	}
}

// The form says nothing about who is registered: an unverified account, a
// confirmed one, and an address with no account at all are answered alike, and
// only the first is mailed anything.
func TestDBRequestEmailVerificationAnswersEveryAddressAlike(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	pending := env.PG.SeedUnverifiedEndUser(t, tenant.ID, "ENDUSERA0001", "pending@tenant-a.example.com", "Pending")
	member := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0002", "member@tenant-a.example.com", "Member")
	client := env.authClient()

	for _, email := range []string{pending.Email, member.Email, "stranger@tenant-a.example.com"} {
		resp, err := client.RequestEmailVerification(context.Background(), connect.NewRequest(&publirav1.RequestEmailVerificationRequest{
			Tenant: tenantContext(tenant),
			Email:  email,
		}))
		if err != nil {
			t.Fatalf("RequestEmailVerification for %s: %v", email, err)
		}
		if !resp.Msg.Requested {
			t.Fatalf("requested = false for %s, want true", email)
		}
	}

	if count := countRows(t, env,
		`SELECT count(*) FROM user_email_verification_tokens WHERE user_id = $1`, member.ID); count != 0 {
		t.Fatalf("verification tokens for the confirmed account = %d, want none", count)
	}
	mails := countRows(t, env, `
		SELECT count(*) FROM outbox_events WHERE event_type = 'reader_email_verification_email'
	`)
	if mails != 1 {
		t.Fatalf("queued verification mails = %d, want only the one for the unverified address", mails)
	}
}

// The link the resend mails activates the account, which is the whole point of
// asking for one: the reader who lost the first mail reaches a working link.
func TestDBRequestEmailVerificationIssuesALinkThatActivatesTheAccount(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	pending := env.PG.SeedUnverifiedEndUser(t, tenant.ID, "ENDUSERA0001", "pending@tenant-a.example.com", "Pending")
	env.seedEmailVerificationToken(t, tenant.ID, pending.ID, "expired-token", time.Now().Add(-time.Hour))
	client := env.authClient()

	if _, err := client.RequestEmailVerification(context.Background(), connect.NewRequest(&publirav1.RequestEmailVerificationRequest{
		Tenant: tenantContext(tenant),
		Email:  pending.Email,
	})); err != nil {
		t.Fatalf("RequestEmailVerification: %v", err)
	}

	// The row stores only the hash, so the mail's payload is the one readable
	// form of the link — the same place the outbox worker reads it from.
	var token string
	if err := env.PG.DB.QueryRow(`
		SELECT payload ->> 'token' FROM outbox_events
		WHERE event_type = 'reader_email_verification_email'
	`).Scan(&token); err != nil {
		t.Fatalf("read the queued verification link: %v", err)
	}

	verified, err := client.VerifyUserEmail(context.Background(), connect.NewRequest(&publirav1.VerifyUserEmailRequest{
		Tenant: tenantContext(tenant),
		Token:  token,
	}))
	if err != nil {
		t.Fatalf("VerifyUserEmail with the resent link: %v", err)
	}
	if !verified.Msg.Verified {
		t.Fatal("verified = false, want true")
	}
	if account := readStoredAccount(t, env, pending.Email); !account.verified {
		t.Fatal("the account is still unconfirmed after its resent link was opened")
	}

	// The expired link the resend replaced cannot be spent afterwards.
	if _, err := client.VerifyUserEmail(context.Background(), connect.NewRequest(&publirav1.VerifyUserEmailRequest{
		Tenant: tenantContext(tenant),
		Token:  "expired-token",
	})); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("VerifyUserEmail with the replaced link = %v, want not_found", err)
	}
}

// Two requests for the same address at once still leave one live link. A reader
// who submits the form twice is the ordinary way this happens, and without the
// lock on the account row the two transactions cannot see each other's token:
// both would insert one, and both links would stay valid.
func TestDBRequestEmailVerificationKeepsOneLinkUnderConcurrentRequests(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	pending := env.PG.SeedUnverifiedEndUser(t, tenant.ID, "ENDUSERA0001", "pending@tenant-a.example.com", "Pending")
	client := env.authClient()

	const requests = 2
	start := make(chan struct{})
	errs := make(chan error, requests)
	var wg sync.WaitGroup
	for range requests {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, err := client.RequestEmailVerification(context.Background(), connect.NewRequest(&publirav1.RequestEmailVerificationRequest{
				Tenant: tenantContext(tenant),
				Email:  pending.Email,
			}))
			errs <- err
		}()
	}
	close(start)
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("RequestEmailVerification: %v", err)
		}
	}

	live := countRows(t, env, `
		SELECT count(*) FROM user_email_verification_tokens
		WHERE user_id = $1 AND used_at IS NULL
	`, pending.ID)
	if live != 1 {
		t.Fatalf("live verification tokens = %d, want 1", live)
	}
}
