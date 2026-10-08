package publicapi

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"

	"github.com/publira/publira/server/api/adminapi"
	"github.com/publira/publira/server/api/platformapi"
	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/loginguard"
	"github.com/publira/publira/server/internal/mailguard"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/platformpolicy"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	publirasplatformv1connect "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1/publirasplatformv1connect"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// One process serves the storefront, the tenant console and the platform
// console, and hands all three one mail guard. These cases build the three the
// way that process does, over the counters kept in it when no Redis is named:
// with a guard per namespace, each would hold an allowance of its own and a
// caller would get one of each by moving between them.

// consoleClients are the auth services of the two console namespaces, served
// beside a storefront the way one process serves all three.
type consoleClients struct {
	tenant   publiraadminv1connect.AdminAuthServiceClient
	platform publirasplatformv1connect.PlatformAuthServiceClient
}

// startConsolesWithMailGuard starts the tenant console and the platform console
// over env's database, charging mail as the storefront of env does.
func startConsolesWithMailGuard(t *testing.T, env *publicDBEnv, mail *mailguard.Guard) consoleClients {
	t.Helper()

	adminDB := env.PG.OpenAdminDB(t)
	adminRecorder := auditlog.NewAsync(dbmodels.New(adminDB), adminDB, slog.Default())
	t.Cleanup(adminRecorder.Close)
	adminAPI, err := adminapi.NewWithAsyncRecorder(adminDB, dbmodels.New(adminDB), &testStorageProvider{}, slog.Default(), nil, nil, testutil.TokenManager(), nil, adminRecorder, nil, loginguard.NewDefault(), mail)
	if err != nil {
		t.Fatalf("new admin handler: %v", err)
	}

	platformDB := env.PG.OpenPlatformDB(t)
	platformRecorder := auditlog.NewAsync(dbmodels.New(platformDB), nil, slog.Default())
	t.Cleanup(platformRecorder.Close)
	platformAPI := platformapi.NewWithAsyncRecorder(platformDB, dbmodels.New(platformDB), slog.Default(), nil, nil, testutil.TokenManager(), platformRecorder, nil, loginguard.NewDefault(), mail)

	mux := http.NewServeMux()
	adminAPI.Register(mux)
	platformAPI.Register(mux)
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	transport := connecthttp.NewTransport(server.Client(), server.URL)
	return consoleClients{
		tenant:   publiraadminv1connect.NewAdminAuthServiceClient(connect.NewClient(transport)),
		platform: publirasplatformv1connect.NewPlatformAuthServiceClient(connect.NewClient(transport)),
	}
}

// The origin's allowance is counted across every tenant and the console
// alongside them, so mail asked for on the storefront and on the tenant console
// is spent from the allowance the platform console charges as well.
func TestDBTheMailAllowanceOfASourceIsOneAcrossTheThreeNamespaces(t *testing.T) {
	mail := mailGuardWith(platformpolicy.HourDay{PerHour: 1000, PerDay: 1000}, platformpolicy.HourDay{PerHour: 2, PerDay: 2})
	env := newPublicDBEnvWithMailGuard(t, mail)
	consoles := startConsolesWithMailGuard(t, env, mail)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	if _, err := env.authClient().RequestPasswordReset(context.Background(), &publirav1.RequestPasswordResetRequest{
		Tenant: tenantContext(tenant),
		Email:  "member@tenant-a.example.com",
	}); err != nil {
		t.Fatalf("RequestPasswordReset on the storefront: %v", err)
	}
	if _, err := consoles.tenant.RequestPasswordReset(context.Background(), &publiraadminv1.AdminAuthServiceRequestPasswordResetRequest{
		Tenant: tenantContext(tenant),
		Email:  "admin@tenant-a.example.com",
	}); err != nil {
		t.Fatalf("RequestPasswordReset on the tenant console: %v", err)
	}

	_, err := consoles.platform.RequestPasswordReset(context.Background(), &publirasplatformv1.PlatformAuthServiceRequestPasswordResetRequest{
		Email: "operator@example.com",
	})
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("RequestPasswordReset on the platform console after the other two code = %v, want resource_exhausted (err=%v)", connect.CodeOf(err), err)
	}
	if count := countRows(t, env, `SELECT count(*) FROM outbox_events WHERE event_type = $1`, outbox.EventTypePlatformPasswordResetRequest); count != 0 {
		t.Fatalf("recorded platform reset requests = %d, want none", count)
	}
}

// The storefront and the tenant console both charge the tenant's id as the
// scope of an address, so a mailbox within a tenant holds one allowance however
// the two surfaces are asked to mail it.
func TestDBTheStorefrontAndTheTenantConsoleShareTheMailAllowanceOfAnAddress(t *testing.T) {
	mail := mailGuardWith(platformpolicy.HourDay{PerHour: 1, PerDay: 100}, platformpolicy.HourDay{PerHour: 1000, PerDay: 1000})
	env := newPublicDBEnvWithMailGuard(t, mail)
	consoles := startConsolesWithMailGuard(t, env, mail)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	staff := env.PG.SeedTenantAdmin(t, tenant.ID, "TAUSER01", "admin@tenant-a.example.com", "Admin")

	if _, err := env.authClient().RequestPasswordReset(context.Background(), &publirav1.RequestPasswordResetRequest{
		Tenant: tenantContext(tenant),
		Email:  staff.Email,
	}); err != nil {
		t.Fatalf("RequestPasswordReset on the storefront: %v", err)
	}

	_, err := consoles.tenant.RequestPasswordReset(context.Background(), &publiraadminv1.AdminAuthServiceRequestPasswordResetRequest{
		Tenant: tenantContext(tenant),
		Email:  staff.Email,
	})
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("RequestPasswordReset on the tenant console after the storefront code = %v, want resource_exhausted (err=%v)", connect.CodeOf(err), err)
	}
	if count := countRows(t, env, `SELECT count(*) FROM outbox_events WHERE event_type = $1`, outbox.EventTypeAdminPasswordResetRequest); count != 0 {
		t.Fatalf("recorded tenant console reset requests = %d, want none", count)
	}
}
