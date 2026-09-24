package publicapi

import (
	"context"
	"database/sql"
	"log/slog"
	"net/http/httptest"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/mailguard"
	"github.com/publira/publira/server/internal/platformpolicy"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/ratelimit"
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

	return newPublicDBEnvWithGuards(t, openReaderGuards())
}

// newPublicDBEnvWithGuards is newPublicDBEnv for the cases that are about the
// reader flood control itself and need it tight enough to reach.
func newPublicDBEnvWithGuards(t *testing.T, guards readerGuards) *publicDBEnv {
	t.Helper()

	return newPublicDBEnvWith(t, guards, openMailGuard())
}

// newPublicDBEnvWithMailGuard is newPublicDBEnv for the cases that are about
// the limit on the mail a form causes.
func newPublicDBEnvWithMailGuard(t *testing.T, mail *mailguard.Guard) *publicDBEnv {
	t.Helper()

	return newPublicDBEnvWith(t, openReaderGuards(), mail)
}

func newPublicDBEnvWith(t *testing.T, guards readerGuards, mail *mailguard.Guard) *publicDBEnv {
	t.Helper()

	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	db := pg.OpenPublicDB(t)

	// Secret decryption belongs to the payment flows, which these tests seed
	// around rather than drive. The auth mails are outbox rows the public API
	// writes and never sends, so no SMTP client takes part here.
	//
	// The guards are built here rather than read from the environment: the
	// counters would otherwise be the deployment's shared Redis, where one run
	// of these tests would charge the budget of the next.
	server := httptest.NewServer(handlerFromServer(
		newAPIServer(db, dbmodels.New(db), nil, testutil.TokenManager(), slog.Default(), guards, mail),
	))
	t.Cleanup(server.Close)
	return &publicDBEnv{Server: server, PG: pg}
}

// openPolicy allows far more than any case that is not about a limit reaches,
// so those cases assert the behaviour they are about rather than the limit they
// happen to sit under. Every case in this package shares one loopback address,
// which is what the per-client and per-origin allowances are keyed on.
func openPolicy() platformpolicy.Policy {
	open := platformpolicy.MinuteDay{PerMinute: 1000, PerDay: 1000}
	openHourly := platformpolicy.HourDay{PerHour: 1000, PerDay: 1000}
	policy := platformpolicy.Defaults()
	policy.PasswordVerification = open
	policy.MailRequestsPerAddress = openHourly
	policy.MailRequestsPerSource = openHourly
	policy.Community.CommentPost = open
	policy.Community.CommentReport = open
	policy.Community.EpisodeRating = open
	policy.Community.ContactMessagePerAccount = openHourly
	policy.Community.ContactMessagePerClient = openHourly
	policy.Community.ViewerPreferencesUpdate = open
	policy.StorePurchaseConfirmation = open
	return policy
}

// openReaderGuards is openPolicy over in-process counters.
func openReaderGuards() readerGuards {
	return guardsWith(func(*platformpolicy.Policy) {})
}

// guardsWith is openPolicy with the values a case is about tightened by adjust.
// Tightening both halves of a limit keeps the allowance from refilling when a
// case happens to run across the boundary of its shorter window.
func guardsWith(adjust func(*platformpolicy.Policy)) readerGuards {
	policy := openPolicy()
	adjust(&policy)
	return readerGuards{
		limiter: ratelimit.New(ratelimit.NewMemoryStore()),
		policy:  platformpolicy.Fixed(policy),
	}
}

// openMailGuard is openReaderGuards for the mail limit: the cases that are not
// about it drive forms that would otherwise spend an allowance meant for a
// person, and every one of them shares this process's loopback address.
func openMailGuard() *mailguard.Guard {
	return mailGuardWith(platformpolicy.HourDay{PerHour: 1000, PerDay: 1000}, platformpolicy.HourDay{PerHour: 1000, PerDay: 1000})
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

func (e *publicDBEnv) contactClient() publirav1connect.ContactServiceClient {
	return publirav1connect.NewContactServiceClient(e.Server.Client(), e.Server.URL)
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

// mailGuardWith is a mail guard over in-process counters whose mail-request
// limits are the ones given, and whose other values are the built-in defaults.
func mailGuardWith(perAddress, perSource platformpolicy.HourDay) *mailguard.Guard {
	policy := platformpolicy.Defaults()
	policy.MailRequestsPerAddress = perAddress
	policy.MailRequestsPerSource = perSource
	return mailguard.New(ratelimit.New(ratelimit.NewMemoryStore()), platformpolicy.Fixed(policy), slog.Default())
}
