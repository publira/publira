package adminapi

import (
	"context"
	"database/sql"
	"log/slog"
	"net/http/httptest"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publiraadminv1connect "github.com/publira/publira/server/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/testutil"
)

// adminDBEnv is an admin API server backed by a real PostgreSQL (Testcontainers).
// The handler connects as publira_admin, the role tenant isolation policies apply
// to, so anything these tests read or write goes through RLS the way production
// does. The sqlmock-based tests in this package cannot see that layer at all.
type adminDBEnv struct {
	Server *httptest.Server
	PG     *testutil.PostgresEnv
}

// newAdminDBEnv resets the shared database and starts a server on it. Nothing is
// seeded; tests add tenants through [adminDBEnv.seedTenantWithAdmin].
func newAdminDBEnv(t *testing.T) *adminDBEnv {
	t.Helper()

	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	db := pg.OpenAdminDB(t)

	server := httptest.NewServer(NewHandler(db, dbmodels.New(db), &testStorageProvider{}, slog.Default(), nil, nil))
	t.Cleanup(server.Close)
	return &adminDBEnv{Server: server, PG: pg}
}

// adminDBTenant pairs a seeded tenant with the user that signs requests for it.
// That user is the tenant_admin unless a test swaps it via [adminDBTenant.as].
type adminDBTenant struct {
	Tenant testutil.Tenant
	User   testutil.TenantUser
}

// seedTenantWithAdmin seeds one tenant and its tenant_admin. Cross-tenant cases
// call it twice, so every identifier is a parameter rather than a fixed value.
func (e *adminDBEnv) seedTenantWithAdmin(t *testing.T, tenantPublicID, domain, name, userPublicID, email string) adminDBTenant {
	t.Helper()

	tenant := e.PG.SeedTenant(t, tenantPublicID, domain, name)
	admin := e.PG.SeedTenantAdmin(t, tenant.ID, userPublicID, email, name+" Admin")
	return adminDBTenant{Tenant: tenant, User: admin}
}

// as signs subsequent requests as another user of the same tenant, which is how
// role-restricted RPCs get exercised from a non-admin seat.
func (a adminDBTenant) as(user testutil.TenantUser) adminDBTenant {
	return adminDBTenant{Tenant: a.Tenant, User: user}
}

// tenantContext addresses the tenant the way the admin console does: by the
// tenant primary key carried in every request.
func (a adminDBTenant) tenantContext() *publirattypesv1.TenantContext {
	return &publirattypesv1.TenantContext{TenantId: a.Tenant.ID.String()}
}

func (a adminDBTenant) token() string {
	token, _, err := auth.MustTokenManagerFromEnv().Issue(
		a.User.PublicID,
		auth.AudienceAdmin,
		a.Tenant.ID.String(),
		a.User.Role,
		a.User.CredentialsVersion,
		time.Now(),
	)
	if err != nil {
		panic(err)
	}
	return token
}

// newAdminDBRequest signs the request as the tenant's current user. The tenant context
// stays with the caller because it lives in the message, not in the header.
func newAdminDBRequest[T any](tenant adminDBTenant, msg *T) *connect.Request[T] {
	req := connect.NewRequest(msg)
	req.Header().Set("Authorization", "Bearer "+tenant.token())
	return req
}

func (e *adminDBEnv) seriesClient() publiraadminv1connect.AdminSeriesServiceClient {
	return publiraadminv1connect.NewAdminSeriesServiceClient(e.Server.Client(), e.Server.URL)
}

func (e *adminDBEnv) creatorClient() publiraadminv1connect.AdminCreatorServiceClient {
	return publiraadminv1connect.NewAdminCreatorServiceClient(e.Server.Client(), e.Server.URL)
}

func (e *adminDBEnv) labelClient() publiraadminv1connect.AdminLabelServiceClient {
	return publiraadminv1connect.NewAdminLabelServiceClient(e.Server.Client(), e.Server.URL)
}

func (e *adminDBEnv) authClient() publiraadminv1connect.AdminAuthServiceClient {
	return publiraadminv1connect.NewAdminAuthServiceClient(e.Server.Client(), e.Server.URL)
}

func (e *adminDBEnv) auditClient() publiraadminv1connect.AdminAuditLogServiceClient {
	return publiraadminv1connect.NewAdminAuditLogServiceClient(e.Server.Client(), e.Server.URL)
}

// withTenantConn hands fn a publira_admin connection scoped to one tenant, the
// same way the request interceptor scopes handler queries. Use it to look at
// what RLS lets that tenant reach, rather than what a handler chose to return.
func (e *adminDBEnv) withTenantConn(t *testing.T, tenantID uuid.UUID, fn func(ctx context.Context, conn *sql.Conn)) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	db := e.PG.OpenAdminDB(t)
	conn, err := db.Conn(ctx)
	if err != nil {
		t.Fatalf("admin conn: %v", err)
	}
	defer conn.Close() //nolint:errcheck

	if _, err := conn.ExecContext(ctx, "SELECT set_config('app.current_tenant_id', $1, false)", tenantID.String()); err != nil {
		t.Fatalf("set app.current_tenant_id: %v", err)
	}
	fn(ctx, conn)
}

// countRows runs a counting query on the superuser connection, which bypasses
// RLS, so assertions can look at rows the tenant under test must not see.
func (e *adminDBEnv) countRows(t *testing.T, query string, args ...any) int {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var count int
	if err := e.PG.DB.QueryRowContext(ctx, query, args...).Scan(&count); err != nil {
		t.Fatalf("query %q: %v", query, err)
	}
	return count
}
