package publicapi

import (
	"context"
	"testing"

	"connectrpc.com/connect/v2"

	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/tenantstatus"
	"github.com/publira/publira/server/internal/testutil"
)

// A suspended tenant is refused everywhere the storefront and the app reach it
// — the domain lookup, a guest read, a signed-in read, and sign-in itself — and
// resuming it serves all of them again, the session issued before the
// suspension included.
func TestDBSuspendedTenantIsRefusedUntilResumed(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant, other := env.seedTwoTenants(t)
	user := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	token := tokenFor(t, tenant, user)
	ctx := context.Background()

	calls := []struct {
		name string
		call func() error
	}{
		{name: "GetTenantByDomain", call: func() error {
			_, err := env.domainClient().GetTenantByDomain(ctx, &publirav1.GetTenantByDomainRequest{Domains: []string{tenant.Domain}})
			return err
		}},
		{name: "ListPublishedSeries", call: func() error {
			_, err := env.catalogClient().ListPublishedSeries(ctx, &publirav1.ListPublishedSeriesRequest{Tenant: tenantContext(tenant)})
			return err
		}},
		{name: "GetMe", call: func() error {
			_, err := env.authClient().GetMe(testutil.WithBearer(ctx, token), &publirav1.GetMeRequest{Tenant: tenantContext(tenant)})
			return err
		}},
		{name: "Login", call: func() error {
			_, err := env.authClient().Login(ctx, &publirav1.LoginRequest{Tenant: tenantContext(tenant), Email: user.Email, Password: testutil.SeededPassword})
			return err
		}},
	}

	env.PG.SetTenantStatus(t, tenant.ID, tenantstatus.Suspended)
	for _, c := range calls {
		err := c.call()
		if connect.CodeOf(err) != connect.CodeFailedPrecondition {
			t.Fatalf("%s on a suspended tenant: code = %v, want failed_precondition (err=%v)", c.name, connect.CodeOf(err), err)
		}
		if reason, _ := errorInfoReason(err); reason != rpcerrors.ReasonTenantSuspended {
			t.Fatalf("%s on a suspended tenant: reason = %q, want %s", c.name, reason, rpcerrors.ReasonTenantSuspended)
		}
	}

	// The suspension is the tenant's alone, and a host no tenant serves is
	// still answered as one.
	if _, err := env.domainClient().GetTenantByDomain(ctx, &publirav1.GetTenantByDomainRequest{Domains: []string{other.Domain}}); err != nil {
		t.Fatalf("GetTenantByDomain for another tenant: %v", err)
	}
	_, err := env.domainClient().GetTenantByDomain(ctx, &publirav1.GetTenantByDomainRequest{Domains: []string{"unknown.example.com"}})
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetTenantByDomain for an unknown host: code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}

	env.PG.SetTenantStatus(t, tenant.ID, tenantstatus.Active)
	for _, c := range calls {
		if err := c.call(); err != nil {
			t.Fatalf("%s after the tenant is resumed: %v", c.name, err)
		}
	}
}
