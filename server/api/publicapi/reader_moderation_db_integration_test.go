package publicapi

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/testutil"
)

// What a tenant admin does to a reader through AdminUserService is only worth
// something if the storefront answers to it, so these cases act through the
// admin API and observe through the public one.

type adminReaderConsole struct {
	client publiraadminv1connect.AdminUserServiceClient
	tenant *publirattypesv1.TenantContext
	token  string
}

func (e *publicDBEnv) openAdminReaderConsole(t *testing.T, tenant testutil.Tenant) adminReaderConsole {
	t.Helper()

	staff := e.PG.SeedTenantAdmin(t, tenant.ID, "READERADMIN1", "admin@"+tenant.Domain, "Admin")
	console := e.openAdminConsole(t, tenant, staff)
	return adminReaderConsole{
		client: publiraadminv1connect.NewAdminUserServiceClient(console.server.Client(), console.server.URL),
		tenant: &publirattypesv1.TenantContext{TenantId: tenant.ID.String()},
		token:  console.token,
	}
}

func adminReaderRequest[T any](console adminReaderConsole, msg *T) *connect.Request[T] {
	req := connect.NewRequest(msg)
	req.Header().Set("Authorization", "Bearer "+console.token)
	return req
}

func (c adminReaderConsole) suspend(t *testing.T, publicID string) *publiraadminv1.AdminReader {
	t.Helper()

	res, err := c.client.SuspendReader(context.Background(), adminReaderRequest(c, &publiraadminv1.SuspendReaderRequest{Tenant: c.tenant, PublicId: publicID}))
	if err != nil {
		t.Fatalf("SuspendReader %s: %v", publicID, err)
	}
	return res.Msg.Reader
}

func (c adminReaderConsole) unsuspend(t *testing.T, publicID string) *publiraadminv1.AdminReader {
	t.Helper()

	res, err := c.client.UnsuspendReader(context.Background(), adminReaderRequest(c, &publiraadminv1.UnsuspendReaderRequest{Tenant: c.tenant, PublicId: publicID}))
	if err != nil {
		t.Fatalf("UnsuspendReader %s: %v", publicID, err)
	}
	return res.Msg.Reader
}

func loginReader(client publirav1connect.AuthServiceClient, tenant testutil.Tenant, email string) (*connect.Response[publirav1.LoginResponse], error) {
	return client.Login(context.Background(), connect.NewRequest(&publirav1.LoginRequest{
		Tenant:   tenantContext(tenant),
		Email:    email,
		Password: testutil.SeededPassword,
	}))
}

func TestDBAdminSuspensionRefusesTheReaderUntilItIsLifted(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	reader := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "reader@tenant-a.example.com", "Reader")
	console := env.openAdminReaderConsole(t, tenant)
	client := env.authClient()

	login, err := loginReader(client, tenant, reader.Email)
	if err != nil {
		t.Fatalf("Login before the suspension: %v", err)
	}
	session := login.Msg.AccessToken.Token

	if got := console.suspend(t, reader.PublicID); got.Status != "suspended" {
		t.Fatalf("suspended reader status = %q, want suspended", got.Status)
	}

	if _, err := client.GetMe(context.Background(), newBearerRequest(&publirav1.GetMeRequest{Tenant: tenantContext(tenant)}, session)); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("GetMe with a session from before the suspension = %v, want unauthenticated", err)
	}
	// The same refusal a platform suspension produces.
	if _, err := loginReader(client, tenant, reader.Email); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("Login while suspended = %v, want failed_precondition", err)
	}

	if got := console.unsuspend(t, reader.PublicID); got.Status != "active" {
		t.Fatalf("unsuspended reader status = %q, want active", got.Status)
	}

	// Lifting the suspension does not bring back the sessions it ended.
	if _, err := client.GetMe(context.Background(), newBearerRequest(&publirav1.GetMeRequest{Tenant: tenantContext(tenant)}, session)); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("GetMe with a session from before the suspension after it was lifted = %v, want unauthenticated", err)
	}
	relogin, err := loginReader(client, tenant, reader.Email)
	if err != nil {
		t.Fatalf("Login after the suspension was lifted: %v", err)
	}
	if _, err := client.GetMe(context.Background(), newBearerRequest(&publirav1.GetMeRequest{Tenant: tenantContext(tenant)}, relogin.Msg.AccessToken.Token)); err != nil {
		t.Fatalf("GetMe with a session from after the suspension was lifted: %v", err)
	}
}

// Confirming an address activates an account that was waiting for it, and
// nothing else: a reader suspended before opening the link stays suspended.
func TestDBVerifyUserEmailDoesNotLiftAnAdminSuspension(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	pending := env.PG.SeedUnverifiedEndUser(t, tenant.ID, "ENDUSERA0001", "pending@tenant-a.example.com", "Pending")
	env.seedEmailVerificationToken(t, tenant.ID, pending.ID, "pending-token", time.Now().Add(time.Hour))
	console := env.openAdminReaderConsole(t, tenant)
	client := env.authClient()

	console.suspend(t, pending.PublicID)

	if _, err := client.VerifyUserEmail(context.Background(), connect.NewRequest(&publirav1.VerifyUserEmailRequest{
		Tenant: tenantContext(tenant),
		Token:  "pending-token",
	})); err != nil {
		t.Fatalf("VerifyUserEmail while suspended: %v", err)
	}
	if _, err := loginReader(client, tenant, pending.Email); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("Login after confirming the address while suspended = %v, want failed_precondition", err)
	}

	// The address was confirmed all the same, so lifting the suspension leaves
	// nothing more to wait for.
	if got := console.unsuspend(t, pending.PublicID); got.Status != "active" {
		t.Fatalf("unsuspended reader status = %q, want active", got.Status)
	}
	if _, err := loginReader(client, tenant, pending.Email); err != nil {
		t.Fatalf("Login after the suspension was lifted: %v", err)
	}
}

// A reader who never confirmed their address goes back to waiting for it,
// rather than to an active account nobody confirmed.
func TestDBAdminUnsuspendReturnsAnUnconfirmedReaderToInactive(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	pending := env.PG.SeedUnverifiedEndUser(t, tenant.ID, "ENDUSERA0001", "pending@tenant-a.example.com", "Pending")
	env.seedEmailVerificationToken(t, tenant.ID, pending.ID, "pending-token", time.Now().Add(time.Hour))
	console := env.openAdminReaderConsole(t, tenant)
	client := env.authClient()

	console.suspend(t, pending.PublicID)
	if got := console.unsuspend(t, pending.PublicID); got.Status != "inactive" {
		t.Fatalf("unsuspended unconfirmed reader status = %q, want inactive", got.Status)
	}

	if _, err := client.VerifyUserEmail(context.Background(), connect.NewRequest(&publirav1.VerifyUserEmailRequest{
		Tenant: tenantContext(tenant),
		Token:  "pending-token",
	})); err != nil {
		t.Fatalf("VerifyUserEmail after the suspension was lifted: %v", err)
	}
	if _, err := loginReader(client, tenant, pending.Email); err != nil {
		t.Fatalf("Login after confirming the address: %v", err)
	}
}

// An account a tenant admin deletes is gone the way DeleteMe leaves one: the
// session and the sign-in both stop, and the purchases stay without the buyer.
func TestDBAdminDeleteReaderLeavesWhatDeleteMeLeaves(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	buyer := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "buyer@tenant-a.example.com", "Buyer")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESPUB001", Published: true})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODE00001",
		Price:    300,
		Status:   testutil.EpisodeStatusPublished,
	})
	env.PG.SeedPurchase(t, tenant.ID, buyer.ID, episode.ID, 300)
	session := tokenFor(t, tenant, buyer)
	console := env.openAdminReaderConsole(t, tenant)
	client := env.authClient()

	res, err := console.client.DeleteReader(context.Background(), adminReaderRequest(console, &publiraadminv1.DeleteReaderRequest{
		Tenant:   console.tenant,
		PublicId: buyer.PublicID,
	}))
	if err != nil {
		t.Fatalf("DeleteReader: %v", err)
	}
	if res.Msg.PublicId != buyer.PublicID {
		t.Fatalf("deleted public_id = %q, want %q", res.Msg.PublicId, buyer.PublicID)
	}

	if count := env.countRows(t, "SELECT count(*) FROM users WHERE id = $1", buyer.ID); count != 0 {
		t.Fatalf("users rows for the deleted reader = %d, want 0", count)
	}
	if count := env.countRows(t,
		"SELECT count(*) FROM purchases WHERE tenant_id = $1 AND episode_id = $2 AND user_id IS NULL",
		tenant.ID, episode.ID,
	); count != 1 {
		t.Fatalf("purchases kept without the buyer = %d, want 1", count)
	}

	if _, err := client.GetMe(context.Background(), newBearerRequest(&publirav1.GetMeRequest{Tenant: tenantContext(tenant)}, session)); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("GetMe with the deleted reader's session = %v, want unauthenticated", err)
	}
	if _, err := loginReader(client, tenant, buyer.Email); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("Login as the deleted reader = %v, want unauthenticated", err)
	}
}
