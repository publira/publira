package publicapi

import (
	"context"
	"database/sql"
	"net/http/httptest"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	publirav1connect "github.com/publira/publira/server/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/testutil"
)

// publicDBEnv is a public API server backed by a real PostgreSQL (Testcontainers).
// The handler connects as publira_public, the RLS-bound role the storefront runs
// as, so every row these tests read passes both the handler's own published /
// unpublished filtering and the tenant isolation policies. The sqlmock-based
// tests in this package replay canned rows and can see neither layer.
type publicDBEnv struct {
	Server *httptest.Server
	PG     *testutil.PostgresEnv
}

// newPublicDBEnv resets the shared database and starts a server on it. Nothing is
// seeded; tests add tenants through [publicDBEnv.seedTenant].
func newPublicDBEnv(t *testing.T) *publicDBEnv {
	t.Helper()

	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	db := pg.OpenPublicDB(t)

	// Mail delivery and secret decryption belong to the signup and password reset
	// flows, which these tests seed around rather than drive.
	server := httptest.NewServer(NewHandler(db, dbmodels.New(db), &testStorageProvider{}, nil, nil, testutil.TokenManager()))
	t.Cleanup(server.Close)
	return &publicDBEnv{Server: server, PG: pg}
}

func (e *publicDBEnv) seedTenant(t *testing.T, publicID, domain, name string) testutil.Tenant {
	t.Helper()
	return e.PG.SeedTenant(t, publicID, domain, name)
}

// seedTwoTenants seeds the pair every cross-tenant case needs. Series, episode
// and user public IDs are unique database-wide, so no two seeds may share one.
func (e *publicDBEnv) seedTwoTenants(t *testing.T) (testutil.Tenant, testutil.Tenant) {
	t.Helper()

	first := e.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	second := e.seedTenant(t, "TENANTB", "tenant-b.example.com", "Tenant B")
	return first, second
}

// tenantContext addresses the tenant the way the storefront does: by the tenant
// primary key carried in every request.
func tenantContext(tenant testutil.Tenant) *publirattypesv1.TenantContext {
	return &publirattypesv1.TenantContext{TenantId: tenant.ID.String()}
}

// tokenFor mints the access token the public API issues at login, so a test can
// exercise an authenticated read without driving Login first.
func tokenFor(t *testing.T, tenant testutil.Tenant, user testutil.TenantUser) string {
	t.Helper()

	token, _, err := testutil.TokenManager().Issue(
		user.PublicID,
		auth.AudiencePublic,
		tenant.ID.String(),
		user.Role,
		user.CredentialsVersion,
		time.Now(),
	)
	if err != nil {
		t.Fatalf("issue access token for %s: %v", user.PublicID, err)
	}
	return token
}

// newBearerRequest sends the request as a signed-in member of the tenant.
func newBearerRequest[T any](msg *T, token string) *connect.Request[T] {
	req := connect.NewRequest(msg)
	req.Header().Set("Authorization", "Bearer "+token)
	return req
}

func (e *publicDBEnv) catalogClient() publirav1connect.CatalogServiceClient {
	return publirav1connect.NewCatalogServiceClient(e.Server.Client(), e.Server.URL)
}

func (e *publicDBEnv) episodeReadClient() publirav1connect.EpisodeReadServiceClient {
	return publirav1connect.NewEpisodeReadServiceClient(e.Server.Client(), e.Server.URL)
}

func (e *publicDBEnv) contentViewClient() publirav1connect.ContentViewServiceClient {
	return publirav1connect.NewContentViewServiceClient(e.Server.Client(), e.Server.URL)
}

func (e *publicDBEnv) followClient() publirav1connect.FollowServiceClient {
	return publirav1connect.NewFollowServiceClient(e.Server.Client(), e.Server.URL)
}

func (e *publicDBEnv) ratingClient() publirav1connect.RatingServiceClient {
	return publirav1connect.NewRatingServiceClient(e.Server.Client(), e.Server.URL)
}

func (e *publicDBEnv) commentClient() publirav1connect.CommentServiceClient {
	return publirav1connect.NewCommentServiceClient(e.Server.Client(), e.Server.URL)
}

func (e *publicDBEnv) purchaseClient() publirav1connect.PurchaseServiceClient {
	return publirav1connect.NewPurchaseServiceClient(e.Server.Client(), e.Server.URL)
}

func (e *publicDBEnv) authClient() publirav1connect.AuthServiceClient {
	return publirav1connect.NewAuthServiceClient(e.Server.Client(), e.Server.URL)
}

func (e *publicDBEnv) notificationClient() publirav1connect.NotificationServiceClient {
	return publirav1connect.NewNotificationServiceClient(e.Server.Client(), e.Server.URL)
}

func (e *publicDBEnv) pagesClient() publirav1connect.PublicPagesServiceClient {
	return publirav1connect.NewPublicPagesServiceClient(e.Server.Client(), e.Server.URL)
}

func (e *publicDBEnv) tenantAPIClient() publirav1connect.TenantServiceClient {
	return publirav1connect.NewTenantServiceClient(e.Server.Client(), e.Server.URL)
}

func (e *publicDBEnv) domainClient() publirav1connect.DomainServiceClient {
	return publirav1connect.NewDomainServiceClient(e.Server.Client(), e.Server.URL)
}

// withTenantConn hands fn a publira_public connection scoped to one tenant, the
// same way the request interceptor scopes handler queries. Use it to look at
// what RLS lets the storefront reach, rather than what a handler chose to return.
func (e *publicDBEnv) withTenantConn(t *testing.T, tenantID uuid.UUID, fn func(ctx context.Context, conn *sql.Conn)) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	db := e.PG.OpenPublicDB(t)
	conn, err := db.Conn(ctx)
	if err != nil {
		t.Fatalf("public conn: %v", err)
	}
	defer conn.Close() //nolint:errcheck

	if _, err := conn.ExecContext(ctx, "SELECT set_config('app.current_tenant_id', $1, false)", tenantID.String()); err != nil {
		t.Fatalf("set app.current_tenant_id: %v", err)
	}
	fn(ctx, conn)
}

// bumpCredentialsVersion invalidates every token already handed to the user, the
// way a password reset or an account deletion does.
func (e *publicDBEnv) bumpCredentialsVersion(t *testing.T, userID uuid.UUID) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := dbmodels.New(e.PG.DB).BumpUserCredentialsVersion(ctx, userID); err != nil {
		t.Fatalf("BumpUserCredentialsVersion %s: %v", userID, err)
	}
}

// suspendUser sets the account status the public API must stop honouring.
func (e *publicDBEnv) suspendUser(t *testing.T, userID uuid.UUID) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := dbmodels.New(e.PG.DB).UpdateUserStatusByID(ctx, dbmodels.UpdateUserStatusByIDParams{
		ID:     userID,
		Status: "suspended",
	}); err != nil {
		t.Fatalf("UpdateUserStatusByID %s: %v", userID, err)
	}
}

// countRows runs a counting query on the superuser connection, which bypasses
// RLS, so assertions can look at rows the storefront must not see.
func (e *publicDBEnv) countRows(t *testing.T, query string, args ...any) int {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var count int
	if err := e.PG.DB.QueryRowContext(ctx, query, args...).Scan(&count); err != nil {
		t.Fatalf("query %q: %v", query, err)
	}
	return count
}
