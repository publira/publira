package publicapi

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"

	"github.com/publira/publira/server/api/adminapi"
	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/clientip"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/loginguard"
	"github.com/publira/publira/server/internal/platformpolicy"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// Sign-in as a guesser meets it. Login takes an address anyone can type, so
// these cases drive the real handler against a database: what has to stop at
// the limit is the bcrypt verification and the row behind it, not only the
// shape of the response.

// loginGuardWith is the sign-in limit at perAccount and perSource over
// in-process counters.
func loginGuardWith(perAccount platformpolicy.MinuteDay, perSource platformpolicy.HourDay) *loginguard.Guard {
	policy := openPolicy()
	policy.LoginAttemptsPerAccount = perAccount
	policy.LoginAttemptsPerSource = perSource
	return loginguard.New(testutil.Limiter(), platformpolicy.Fixed(policy), testutil.TokenManager(), nil)
}

// newLoginLimitedEnv starts a server that lets limit passwords be tried for one
// address, and leaves the origin's allowance out of reach.
func newLoginLimitedEnv(t *testing.T, limit int) *publicDBEnv {
	t.Helper()

	return newPublicDBEnvWithLoginGuard(t, loginGuardWith(
		platformpolicy.MinuteDay{PerMinute: limit, PerDay: limit},
		platformpolicy.HourDay{PerHour: 1000, PerDay: 1000},
	))
}

func tryLogin(t *testing.T, env *publicDBEnv, tenant testutil.Tenant, email, password string) error {
	t.Helper()

	_, err := env.authClient().Login(context.Background(), &publirav1.LoginRequest{
		Tenant:   tenantContext(tenant),
		Email:    email,
		Password: password,
	})
	return err
}

func TestDBLoginRefusesPastTheAccountAllowance(t *testing.T) {
	t.Parallel()

	env := newLoginLimitedEnv(t, 3)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	user := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")

	for guess := 1; guess <= 3; guess++ {
		if err := tryLogin(t, env, tenant, user.Email, "not-the-password"); connect.CodeOf(err) != connect.CodeUnauthenticated {
			t.Fatalf("guess %d code = %v, want unauthenticated (err=%v)", guess, connect.CodeOf(err), err)
		}
	}
	// The refusal is its own condition, so a client can tell the reader to
	// come back later rather than that the password is wrong.
	if err := tryLogin(t, env, tenant, user.Email, "not-the-password"); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("a guess past the limit code = %v, want resource_exhausted (err=%v)", connect.CodeOf(err), err)
	}

	// The allowance belongs to the address being guessed at. Every other reader
	// of the tenant still signs in.
	other := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0002", "other@tenant-a.example.com", "Another Reader")
	if err := tryLogin(t, env, tenant, other.Email, testutil.SeededPassword); err != nil {
		t.Fatalf("another reader's sign-in: %v", err)
	}
}

// Past the limit the password is not verified at all, which is the whole point
// of charging before the check: the guesses cost the API no bcrypt. The correct
// password is what proves it — an attempt that was verified would have gone
// through. An address with no account is refused the same way, so the refusal
// does not say which addresses hold one.
func TestDBLoginRefusalVerifiesNothingAndDoesNotRevealTheAccount(t *testing.T) {
	t.Parallel()

	env := newLoginLimitedEnv(t, 1)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	user := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	const nobody = "nobody@tenant-a.example.com"

	for _, email := range []string{user.Email, nobody} {
		if err := tryLogin(t, env, tenant, email, "not-the-password"); connect.CodeOf(err) != connect.CodeUnauthenticated {
			t.Fatalf("the one guess at %s code = %v, want unauthenticated (err=%v)", email, connect.CodeOf(err), err)
		}
	}

	registered := tryLogin(t, env, tenant, user.Email, testutil.SeededPassword)
	if connect.CodeOf(registered) != connect.CodeResourceExhausted {
		t.Fatalf("the right password past the limit code = %v, want resource_exhausted (err=%v)", connect.CodeOf(registered), registered)
	}
	unknown := tryLogin(t, env, tenant, nobody, testutil.SeededPassword)
	if connect.CodeOf(unknown) != connect.CodeResourceExhausted || unknown.Error() != registered.Error() {
		t.Fatalf("an address with no account past the limit = %v, want the same refusal as %v", unknown, registered)
	}
}

// A reader who mistypes and then gets it right is not held back: reaching the
// password proves they were not guessing, so the tries before it stop counting.
func TestDBLoginCorrectPasswordClearsTheAccountCount(t *testing.T) {
	t.Parallel()

	env := newLoginLimitedEnv(t, 3)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	user := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")

	for typo := 1; typo <= 2; typo++ {
		if err := tryLogin(t, env, tenant, user.Email, "not-the-password"); connect.CodeOf(err) != connect.CodeUnauthenticated {
			t.Fatalf("typo %d code = %v, want unauthenticated (err=%v)", typo, connect.CodeOf(err), err)
		}
	}
	if err := tryLogin(t, env, tenant, user.Email, testutil.SeededPassword); err != nil {
		t.Fatalf("the right password on the last allowance: %v", err)
	}
	for typo := 1; typo <= 3; typo++ {
		if err := tryLogin(t, env, tenant, user.Email, "not-the-password"); connect.CodeOf(err) != connect.CodeUnauthenticated {
			t.Fatalf("typo %d after the right password code = %v, want unauthenticated (err=%v)", typo, connect.CodeOf(err), err)
		}
	}
}

// One origin trying one password against many addresses meets the origin's
// allowance, however fresh each address's own is.
func TestDBLoginRefusesPastTheSourceAllowance(t *testing.T) {
	t.Parallel()

	env := newPublicDBEnvWithLoginGuard(t, loginGuardWith(
		platformpolicy.MinuteDay{PerMinute: 1000, PerDay: 1000},
		platformpolicy.HourDay{PerHour: 2, PerDay: 2},
	))
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	user := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")

	// Signing in is not a guess, so it spends nothing of the origin's.
	for signIn := 1; signIn <= 3; signIn++ {
		if err := tryLogin(t, env, tenant, user.Email, testutil.SeededPassword); err != nil {
			t.Fatalf("sign-in %d: %v", signIn, err)
		}
	}
	for _, email := range []string{"first@tenant-a.example.com", "second@tenant-a.example.com"} {
		if err := tryLogin(t, env, tenant, email, "a-common-password"); connect.CodeOf(err) != connect.CodeUnauthenticated {
			t.Fatalf("the guess at %s code = %v, want unauthenticated (err=%v)", email, connect.CodeOf(err), err)
		}
	}
	if err := tryLogin(t, env, tenant, "third@tenant-a.example.com", "a-common-password"); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("a third address from the same origin code = %v, want resource_exhausted (err=%v)", connect.CodeOf(err), err)
	}
}

// The storefront and the tenant console sign in the same accounts, so the
// process hands both one guard, and guesses made on one of them count against
// the other. Kept in this process, as they are when no Redis is named, two
// guards would be two allowances to rotate between.
func TestDBLoginSharesTheAccountAllowanceWithTheTenantConsole(t *testing.T) {
	t.Parallel()

	login := loginGuardWith(
		platformpolicy.MinuteDay{PerMinute: 2, PerDay: 2},
		platformpolicy.HourDay{PerHour: 1000, PerDay: 1000},
	)
	env := newPublicDBEnvWithLoginGuard(t, login)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	staff := env.PG.SeedTenantAdmin(t, tenant.ID, "TAUSER01", "admin@tenant-a.example.com", "Admin")

	adminDB := env.PG.OpenAdminDB(t)
	recorder := auditlog.NewAsync(dbmodels.New(adminDB), adminDB, slog.Default())
	t.Cleanup(recorder.Close)
	adminAPI, err := adminapi.NewWithAsyncRecorder(adminDB, dbmodels.New(adminDB), &testStorageProvider{}, slog.Default(), nil, nil, testutil.TokenManager(), nil, recorder, nil, nil, login, openMailGuard())
	if err != nil {
		t.Fatalf("new admin handler: %v", err)
	}
	adminMux := http.NewServeMux()
	adminAPI.Register(adminMux)
	adminServer := httptest.NewServer(adminMux)
	t.Cleanup(adminServer.Close)
	console := publiraadminv1connect.NewAdminAuthServiceClient(connect.NewClient(connecthttp.NewTransport(adminServer.Client(), adminServer.URL)))

	for guess := 1; guess <= 2; guess++ {
		if err := tryLogin(t, env, tenant, staff.Email, "not-the-password"); connect.CodeOf(err) != connect.CodeUnauthenticated {
			t.Fatalf("guess %d on the storefront code = %v, want unauthenticated (err=%v)", guess, connect.CodeOf(err), err)
		}
	}
	_, err = console.Login(context.Background(), &publiraadminv1.AdminAuthServiceLoginRequest{
		Tenant:   tenantContext(tenant),
		Email:    staff.Email,
		Password: testutil.SeededPassword,
	})
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("the tenant console after the storefront's guesses code = %v, want resource_exhausted (err=%v)", connect.CodeOf(err), err)
	}
}

// A stranger who knows a reader's address can spend every allowance a device
// that never signed in to it shares, from as many origins as it takes, and
// the reader still signs in from the browser or app they used before.
func TestDBLoginLetsAKnownDeviceInPastWhatStrangersSpent(t *testing.T) {
	t.Parallel()

	pg := testutil.StartIsolatedPostgres(t)
	db := pg.OpenPublicDB(t)
	api := newAPIServer(db, dbmodels.New(db), nil, testutil.TokenManager(), nil, slog.Default(), openReaderGuards(), openMailGuard(), nil)
	api.login = loginGuardWith(platformpolicy.MinuteDay{PerMinute: 1, PerDay: 1}, platformpolicy.HourDay{PerHour: 1000, PerDay: 1000})
	// The origins below are told apart the way the edge tells the server
	// them, through X-Forwarded-For from a proxy it trusts.
	server := httptest.NewServer(clientip.New(clientip.Config{TrustedProxies: clientip.DefaultTrustedProxies}).Middleware(handlerFromServer(api)))
	t.Cleanup(server.Close)
	env := &publicDBEnv{Server: server, PG: pg}
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	user := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	login := func(source, password, deviceToken string) (*publirav1.LoginResponse, error) {
		ctx, info := connect.NewClientContext(context.Background())
		info.RequestHeader().Set("X-Forwarded-For", source)
		return env.authClient().Login(ctx, &publirav1.LoginRequest{
			Tenant:      tenantContext(tenant),
			Email:       user.Email,
			Password:    password,
			DeviceToken: deviceToken,
		})
	}

	first, err := login("198.51.100.7", testutil.SeededPassword, "")
	if err != nil {
		t.Fatalf("the first sign-in: %v", err)
	}
	device := first.GetDevice().GetToken()
	if device == "" || first.GetDevice().GetExpiresAt() == "" {
		t.Fatalf("the first sign-in answered device %v, want a token and its expiry", first.GetDevice())
	}

	for origin := 1; origin <= 10; origin++ {
		source := fmt.Sprintf("203.0.113.%d", origin)
		if _, err := login(source, "not-the-password", ""); connect.CodeOf(err) != connect.CodeUnauthenticated {
			t.Fatalf("the guess from %s code = %v, want unauthenticated (err=%v)", source, connect.CodeOf(err), err)
		}
	}
	if _, err := login("192.0.2.1", testutil.SeededPassword, ""); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("the right password from a device never seen code = %v, want resource_exhausted (err=%v)", connect.CodeOf(err), err)
	}
	again, err := login("192.0.2.1", testutil.SeededPassword, device)
	if err != nil {
		t.Fatalf("the reader's device past what strangers spent: %v", err)
	}
	if again.GetAccessToken().GetToken() == "" || again.GetDevice().GetToken() == "" || again.GetDevice().GetToken() == device {
		t.Fatalf("the sign-in with the device answered %v, want a session and a fresh device", again)
	}
}
