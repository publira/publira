package adminapi

import (
	"context"
	"fmt"
	"log/slog"
	"net/http/httptest"
	"testing"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/clientip"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/loginguard"
	"github.com/publira/publira/server/internal/platformpolicy"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// The console's sign-in as a guesser meets it. Two-step verification protects
// only the administrators who set it up, so for every other member of staff the
// password is all there is, and the limit has to stop the bcrypt verification
// itself rather than only the shape of the response.

// loginGuardWith is the sign-in limit at perAccount and perSource over
// in-process counters, every other limit at its built-in value.
func loginGuardWith(perAccount platformpolicy.MinuteDay, perSource platformpolicy.HourDay) *loginguard.Guard {
	policy := platformpolicy.Defaults()
	policy.LoginAttemptsPerAccount = perAccount
	policy.LoginAttemptsPerSource = perSource
	return loginguard.New(testutil.Limiter(), platformpolicy.Fixed(policy), testutil.TokenManager(), nil)
}

// newLoginLimitedEnv starts a server that lets limit passwords be tried for one
// address, and leaves the origin's allowance out of reach.
func newLoginLimitedEnv(t *testing.T, limit int) *adminDBEnv {
	t.Helper()

	return newAdminDBEnvWithLoginGuard(t, loginGuardWith(
		platformpolicy.MinuteDay{PerMinute: limit, PerDay: limit},
		platformpolicy.HourDay{PerHour: 1000, PerDay: 1000},
	))
}

func tryLogin(t *testing.T, env *adminDBEnv, tenant adminDBTenant, email, password string) error {
	t.Helper()

	_, err := env.authClient().Login(context.Background(), &publiraadminv1.AdminAuthServiceLoginRequest{
		Tenant:   tenant.tenantContext(),
		Email:    email,
		Password: password,
	})
	return err
}

// Past the limit the refusal is its own condition, and the password is not
// verified at all: the correct one is refused too, where a verified attempt
// would have gone through. An address with no account is refused the same way,
// so the refusal does not say which addresses hold one.
func TestDBAdminLoginRefusesPastTheAccountAllowanceWithoutVerifying(t *testing.T) {
	t.Parallel()

	env := newLoginLimitedEnv(t, 2)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	const nobody = "nobody@tenant-a.example.com"

	for _, email := range []string{tenant.User.Email, nobody} {
		for guess := 1; guess <= 2; guess++ {
			if err := tryLogin(t, env, tenant, email, "not-the-password"); connect.CodeOf(err) != connect.CodeUnauthenticated {
				t.Fatalf("guess %d at %s code = %v, want unauthenticated (err=%v)", guess, email, connect.CodeOf(err), err)
			}
		}
	}

	registered := tryLogin(t, env, tenant, tenant.User.Email, testutil.SeededPassword)
	if connect.CodeOf(registered) != connect.CodeResourceExhausted {
		t.Fatalf("the right password past the limit code = %v, want resource_exhausted (err=%v)", connect.CodeOf(registered), registered)
	}
	unknown := tryLogin(t, env, tenant, nobody, testutil.SeededPassword)
	if connect.CodeOf(unknown) != connect.CodeResourceExhausted || unknown.Error() != registered.Error() {
		t.Fatalf("an address with no account past the limit = %v, want the same refusal as %v", unknown, registered)
	}
}

// A member of staff who mistypes and then gets it right is not held back.
func TestDBAdminLoginCorrectPasswordClearsTheAccountCount(t *testing.T) {
	t.Parallel()

	env := newLoginLimitedEnv(t, 3)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")

	for typo := 1; typo <= 2; typo++ {
		if err := tryLogin(t, env, tenant, tenant.User.Email, "not-the-password"); connect.CodeOf(err) != connect.CodeUnauthenticated {
			t.Fatalf("typo %d code = %v, want unauthenticated (err=%v)", typo, connect.CodeOf(err), err)
		}
	}
	if err := tryLogin(t, env, tenant, tenant.User.Email, testutil.SeededPassword); err != nil {
		t.Fatalf("the right password on the last allowance: %v", err)
	}
	for typo := 1; typo <= 3; typo++ {
		if err := tryLogin(t, env, tenant, tenant.User.Email, "not-the-password"); connect.CodeOf(err) != connect.CodeUnauthenticated {
			t.Fatalf("typo %d after the right password code = %v, want unauthenticated (err=%v)", typo, connect.CodeOf(err), err)
		}
	}
}

// One origin trying one password against many addresses meets the origin's
// allowance, however fresh each address's own is.
func TestDBAdminLoginRefusesPastTheSourceAllowance(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnvWithLoginGuard(t, loginGuardWith(
		platformpolicy.MinuteDay{PerMinute: 1000, PerDay: 1000},
		platformpolicy.HourDay{PerHour: 2, PerDay: 2},
	))
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")

	for _, email := range []string{"first@tenant-a.example.com", "second@tenant-a.example.com"} {
		if err := tryLogin(t, env, tenant, email, "a-common-password"); connect.CodeOf(err) != connect.CodeUnauthenticated {
			t.Fatalf("the guess at %s code = %v, want unauthenticated (err=%v)", email, connect.CodeOf(err), err)
		}
	}
	if err := tryLogin(t, env, tenant, tenant.User.Email, testutil.SeededPassword); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("a third address from the same origin code = %v, want resource_exhausted (err=%v)", connect.CodeOf(err), err)
	}
}

// A stranger who knows a member of staff's address can spend every allowance
// a device that never signed in to it shares, from as many origins as it
// takes, and the member still signs in to the console from the browser they
// used before.
func TestDBAdminLoginLetsAKnownDeviceInPastWhatStrangersSpent(t *testing.T) {
	t.Parallel()

	pg := testutil.StartIsolatedPostgres(t)
	db := pg.OpenAdminDB(t)
	api, err := newAPI(db, dbmodels.New(db), &testStorageProvider{}, slog.Default(), newAdminTestEncryptor(t), nil, testutil.TokenManager(), nil, nil, openMailGuard())
	if err != nil {
		t.Fatalf("new admin handler: %v", err)
	}
	api.server.login = loginGuardWith(platformpolicy.MinuteDay{PerMinute: 1, PerDay: 1}, platformpolicy.HourDay{PerHour: 1000, PerDay: 1000})
	// The origins below are told apart the way the edge tells the server
	// them, through X-Forwarded-For from a proxy it trusts.
	server := httptest.NewServer(clientip.New(clientip.Config{TrustedProxies: clientip.DefaultTrustedProxies}).Middleware(handlerFromServer(api.server)))
	t.Cleanup(server.Close)
	env := &adminDBEnv{Server: server, PG: pg}
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	login := func(source, password, deviceToken string) (*publiraadminv1.AdminAuthServiceLoginResponse, error) {
		ctx, info := connect.NewClientContext(context.Background())
		info.RequestHeader().Set("X-Forwarded-For", source)
		return env.authClient().Login(ctx, &publiraadminv1.AdminAuthServiceLoginRequest{
			Tenant:      tenant.tenantContext(),
			Email:       tenant.User.Email,
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
		t.Fatalf("the member's device past what strangers spent: %v", err)
	}
	if again.GetAccessToken().GetToken() == "" || again.GetDevice().GetToken() == "" || again.GetDevice().GetToken() == device {
		t.Fatalf("the sign-in with the device answered %v, want a session and a fresh device", again)
	}
}
