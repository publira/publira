package adminapi

import (
	"context"
	"testing"

	"connectrpc.com/connect/v2"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/tenantstatus"
	"github.com/publira/publira/server/internal/testutil"
)

// A suspended tenant's console is refused from the host lookup through sign-in
// to every request a staff session makes, and resuming the tenant serves all of
// them again, the session issued before the suspension included.
func TestDBSuspendedTenantConsoleIsRefusedUntilResumed(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	other := env.seedTenantWithAdmin(t, "TENANTB", "tenant-b.example.com", "Tenant B", "TBUSER01", "admin@tenant-b.example.com")
	session := testutil.WithBearer(context.Background(), tenant.token())
	ctx := context.Background()

	calls := []struct {
		name string
		call func() error
	}{
		{name: "GetTenantByDomain", call: func() error {
			_, err := env.authClient().GetTenantByDomain(ctx, &publiraadminv1.AdminAuthServiceGetTenantByDomainRequest{Domains: []string{tenant.Tenant.AdminDomain}})
			return err
		}},
		{name: "Login", call: func() error {
			_, err := env.authClient().Login(ctx, &publiraadminv1.AdminAuthServiceLoginRequest{Tenant: tenant.tenantContext(), Email: tenant.User.Email, Password: testutil.SeededPassword})
			return err
		}},
		{name: "GetMe", call: func() error {
			_, err := env.authClient().GetMe(session, &publiraadminv1.AdminAuthServiceGetMeRequest{Tenant: tenant.tenantContext()})
			return err
		}},
		{name: "ListSeries", call: func() error {
			_, err := env.seriesClient().ListSeries(session, &publiraadminv1.ListSeriesRequest{Tenant: tenant.tenantContext()})
			return err
		}},
	}

	env.PG.SetTenantStatus(t, tenant.Tenant.ID, tenantstatus.Suspended)
	for _, c := range calls {
		err := c.call()
		if connect.CodeOf(err) != connect.CodeFailedPrecondition {
			t.Fatalf("%s on a suspended tenant: code = %v, want failed_precondition (err=%v)", c.name, connect.CodeOf(err), err)
		}
		if reason := errorInfoReason(t, err); reason != rpcerrors.ReasonTenantSuspended {
			t.Fatalf("%s on a suspended tenant: reason = %q, want %s", c.name, reason, rpcerrors.ReasonTenantSuspended)
		}
	}

	// The suspension is the tenant's alone, and a host no tenant serves is
	// still answered as one.
	if _, err := env.authClient().GetTenantByDomain(ctx, &publiraadminv1.AdminAuthServiceGetTenantByDomainRequest{Domains: []string{other.Tenant.AdminDomain}}); err != nil {
		t.Fatalf("GetTenantByDomain for another tenant: %v", err)
	}
	_, err := env.authClient().GetTenantByDomain(ctx, &publiraadminv1.AdminAuthServiceGetTenantByDomainRequest{Domains: []string{"admin.unknown.example.com"}})
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetTenantByDomain for an unknown host: code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}

	env.PG.SetTenantStatus(t, tenant.Tenant.ID, tenantstatus.Active)
	for _, c := range calls {
		if err := c.call(); err != nil {
			t.Fatalf("%s after the tenant is resumed: %v", c.name, err)
		}
	}
}
