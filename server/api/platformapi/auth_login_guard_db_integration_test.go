package platformapi

import (
	"context"
	"fmt"
	"log/slog"
	"net/http/httptest"
	"testing"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"

	"github.com/publira/publira/server/internal/clientip"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/loginguard"
	"github.com/publira/publira/server/internal/platformpolicy"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	publirasplatformv1connect "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1/publirasplatformv1connect"
	"github.com/publira/publira/server/internal/testutil"
)

// The Platform Console's sign-in as a guesser meets it. An operator is
// protected by their password alone, so the limit has to stop the bcrypt
// verification itself rather than only the shape of the response.

// loginGuardWith is the sign-in limit at perAccount and perSource over
// in-process counters, every other limit at its built-in value.
func loginGuardWith(perAccount platformpolicy.MinuteDay, perSource platformpolicy.HourDay) *loginguard.Guard {
	policy := platformpolicy.Defaults()
	policy.LoginAttemptsPerAccount = perAccount
	policy.LoginAttemptsPerSource = perSource
	return loginguard.New(testutil.Limiter(), platformpolicy.Fixed(policy), testutil.TokenManager(), nil)
}

// newLoginLimitedServer starts a server that lets limit passwords be tried for
// one address, and leaves the origin's allowance out of reach.
func newLoginLimitedServer(t *testing.T, limit int) (*httptest.Server, testutil.PlatformOperator) {
	t.Helper()

	ts, pg := newDBIntegrationEnvWithLoginGuard(t, loginGuardWith(
		platformpolicy.MinuteDay{PerMinute: limit, PerDay: limit},
		platformpolicy.HourDay{PerHour: 1000, PerDay: 1000},
	))
	return ts, pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")
}

func tryLogin(t *testing.T, ts *httptest.Server, email, password string) error {
	t.Helper()

	client := publirasplatformv1connect.NewPlatformAuthServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	_, err := client.Login(context.Background(), &publirasplatformv1.PlatformAuthServiceLoginRequest{
		Email:    email,
		Password: password,
	})
	return err
}

// Past the limit the refusal is its own condition, and the password is not
// verified at all: the correct one is refused too, where a verified attempt
// would have gone through. An address with no account is refused the same way,
// so the refusal does not say which addresses hold one.
func TestDBLoginRefusesPastTheAccountAllowanceWithoutVerifying(t *testing.T) {
	t.Parallel()

	ts, operator := newLoginLimitedServer(t, 2)
	const nobody = "nobody@example.com"

	for _, email := range []string{operator.Email, nobody} {
		for guess := 1; guess <= 2; guess++ {
			if err := tryLogin(t, ts, email, "not-the-password"); connect.CodeOf(err) != connect.CodeUnauthenticated {
				t.Fatalf("guess %d at %s code = %v, want unauthenticated (err=%v)", guess, email, connect.CodeOf(err), err)
			}
		}
	}

	registered := tryLogin(t, ts, operator.Email, testutil.SeededPassword)
	if connect.CodeOf(registered) != connect.CodeResourceExhausted {
		t.Fatalf("the right password past the limit code = %v, want resource_exhausted (err=%v)", connect.CodeOf(registered), registered)
	}
	unknown := tryLogin(t, ts, nobody, testutil.SeededPassword)
	if connect.CodeOf(unknown) != connect.CodeResourceExhausted || unknown.Error() != registered.Error() {
		t.Fatalf("an address with no account past the limit = %v, want the same refusal as %v", unknown, registered)
	}
}

// An operator who mistypes and then gets it right is not held back.
func TestDBLoginCorrectPasswordClearsTheAccountCount(t *testing.T) {
	t.Parallel()

	ts, operator := newLoginLimitedServer(t, 3)

	for typo := 1; typo <= 2; typo++ {
		if err := tryLogin(t, ts, operator.Email, "not-the-password"); connect.CodeOf(err) != connect.CodeUnauthenticated {
			t.Fatalf("typo %d code = %v, want unauthenticated (err=%v)", typo, connect.CodeOf(err), err)
		}
	}
	if err := tryLogin(t, ts, operator.Email, testutil.SeededPassword); err != nil {
		t.Fatalf("the right password on the last allowance: %v", err)
	}
	for typo := 1; typo <= 3; typo++ {
		if err := tryLogin(t, ts, operator.Email, "not-the-password"); connect.CodeOf(err) != connect.CodeUnauthenticated {
			t.Fatalf("typo %d after the right password code = %v, want unauthenticated (err=%v)", typo, connect.CodeOf(err), err)
		}
	}
}

// One origin trying one password against many addresses meets the origin's
// allowance, however fresh each address's own is.
func TestDBLoginRefusesPastTheSourceAllowance(t *testing.T) {
	t.Parallel()

	ts, pg := newDBIntegrationEnvWithLoginGuard(t, loginGuardWith(
		platformpolicy.MinuteDay{PerMinute: 1000, PerDay: 1000},
		platformpolicy.HourDay{PerHour: 2, PerDay: 2},
	))
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")

	for _, email := range []string{"first@example.com", "second@example.com"} {
		if err := tryLogin(t, ts, email, "a-common-password"); connect.CodeOf(err) != connect.CodeUnauthenticated {
			t.Fatalf("the guess at %s code = %v, want unauthenticated (err=%v)", email, connect.CodeOf(err), err)
		}
	}
	if err := tryLogin(t, ts, operator.Email, testutil.SeededPassword); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("a third address from the same origin code = %v, want resource_exhausted (err=%v)", connect.CodeOf(err), err)
	}
}

// loginFrom signs in from the client address source, sending deviceToken.
func loginFrom(t *testing.T, ts *httptest.Server, source, email, password, deviceToken string) (*publirasplatformv1.PlatformAuthServiceLoginResponse, error) {
	t.Helper()

	client := publirasplatformv1connect.NewPlatformAuthServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	ctx, info := connect.NewClientContext(context.Background())
	info.RequestHeader().Set("X-Forwarded-For", source)
	return client.Login(ctx, &publirasplatformv1.PlatformAuthServiceLoginRequest{
		Email:       email,
		Password:    password,
		DeviceToken: deviceToken,
	})
}

// A stranger who knows an operator's address can spend every allowance a
// device that never signed in to it shares, from as many origins as it
// takes, and the operator still signs in from the browser they used before.
func TestDBLoginLetsAKnownDeviceInPastWhatStrangersSpent(t *testing.T) {
	t.Parallel()

	pg := testutil.StartIsolatedPostgres(t)
	db := pg.OpenPlatformDB(t)
	api := newAPI(db, dbmodels.New(db), slog.Default(), nil, nil, testutil.TokenManager(), nil, openMailGuard(), nil)
	api.server.login = loginGuardWith(platformpolicy.MinuteDay{PerMinute: 1, PerDay: 1}, platformpolicy.HourDay{PerHour: 1000, PerDay: 1000})
	// The origins below are told apart the way the edge tells the server
	// them, through X-Forwarded-For from a proxy it trusts.
	ts := httptest.NewServer(clientip.New(clientip.Config{TrustedProxies: clientip.DefaultTrustedProxies}).Middleware(handlerFromServer(api.server)))
	t.Cleanup(ts.Close)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")

	first, err := loginFrom(t, ts, "198.51.100.7", operator.Email, testutil.SeededPassword, "")
	if err != nil {
		t.Fatalf("the operator's first sign-in: %v", err)
	}
	device := first.GetDevice().GetToken()
	if device == "" || first.GetDevice().GetExpiresAt() == "" {
		t.Fatalf("the first sign-in answered device %v, want a token and its expiry", first.GetDevice())
	}

	for origin := 1; origin <= 10; origin++ {
		source := fmt.Sprintf("203.0.113.%d", origin)
		if _, err := loginFrom(t, ts, source, operator.Email, "not-the-password", ""); connect.CodeOf(err) != connect.CodeUnauthenticated {
			t.Fatalf("the guess from %s code = %v, want unauthenticated (err=%v)", source, connect.CodeOf(err), err)
		}
	}
	if _, err := loginFrom(t, ts, "192.0.2.1", operator.Email, testutil.SeededPassword, ""); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("the right password from a device never seen code = %v, want resource_exhausted (err=%v)", connect.CodeOf(err), err)
	}
	again, err := loginFrom(t, ts, "192.0.2.1", operator.Email, testutil.SeededPassword, device)
	if err != nil {
		t.Fatalf("the operator's device past what strangers spent: %v", err)
	}
	if again.GetAccessToken().GetToken() == "" || again.GetDevice().GetToken() == "" || again.GetDevice().GetToken() == device {
		t.Fatalf("the sign-in with the device answered %v, want a session and a fresh device", again)
	}
}
