package platformapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http/httptest"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/tenanttz"
	"github.com/publira/publira/server/internal/testutil"
)

// newDBIntegrationEnv resets the shared PostgreSQL (Testcontainers) and starts an
// httptest server talking to it as publira_platform. Nothing is seeded, so tests
// that need operators or end users seed them through the returned env.
//
// No SMTP anything: the auth mails are outbox_events rows the resident worker
// picks up, so the RPCs under test never resolve settings or dial a server.
func newDBIntegrationEnv(t *testing.T) (*httptest.Server, *testutil.PostgresEnv) {
	t.Helper()

	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	db := pg.OpenPlatformDB(t)

	server := httptest.NewServer(NewHandler(db, dbmodels.New(db), slog.Default(), nil, nil, testutil.TokenManager()))
	t.Cleanup(server.Close)
	return server, pg
}

// newDBIntegrationTestServer starts an httptest server backed by a real PostgreSQL
// (Testcontainers). Resets the shared DB, seeds a platform operator, and returns
// the server URL plus operator metadata for auth tokens.
func newDBIntegrationTestServer(t *testing.T) (*httptest.Server, testutil.PlatformOperator) {
	t.Helper()

	server, pg := newDBIntegrationEnv(t)
	return server, pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")
}

// newDBIntegrationSuperAdminServer seeds a platform_super_admin, the role every
// operator management RPC requires.
func newDBIntegrationSuperAdminServer(t *testing.T) (*httptest.Server, *testutil.PostgresEnv, testutil.PlatformOperator) {
	t.Helper()

	server, pg := newDBIntegrationEnv(t)
	return server, pg, pg.SeedPlatformSuperAdmin(t, "PLATADMIN001", "superadmin@example.com", "Platform Super Admin")
}

func issueDBIntegrationToken(operator testutil.PlatformOperator) string {
	token, _, err := testutil.TokenManager().Issue(
		operator.PublicID,
		auth.AudiencePlatform,
		"",
		operator.Role,
		operator.CredentialsVersion,
		time.Now(),
	)
	if err != nil {
		panic(err)
	}
	return token
}

func newDBAuthedRequest[T any](operator testutil.PlatformOperator, msg T) *connect.Request[T] {
	req := connect.NewRequest(&msg)
	req.Header().Set("Authorization", "Bearer "+issueDBIntegrationToken(operator))
	return req
}

func newDBBearerRequest[T any](token string, msg T) *connect.Request[T] {
	req := connect.NewRequest(&msg)
	req.Header().Set("Authorization", "Bearer "+token)
	return req
}

// platformOutboxToken pulls the link secret out of the queued mail event, which
// is where a confirmation token now waits until the worker renders it.
func platformOutboxToken(t *testing.T, pg *testutil.PostgresEnv, eventType, idempotencyKeySuffix string) string {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	var payload []byte
	if err := pg.DB.QueryRowContext(ctx, `
		SELECT payload
		FROM outbox_events
		WHERE event_type = $1
			AND idempotency_key LIKE '%' || $2
		ORDER BY id DESC
		LIMIT 1
	`, eventType, idempotencyKeySuffix).Scan(&payload); err != nil {
		t.Fatalf("load %s outbox event: %v", eventType, err)
	}

	var body struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(payload, &body); err != nil {
		t.Fatalf("decode %s payload: %v", eventType, err)
	}
	if body.Token == "" {
		t.Fatalf("%s payload carries no token", eventType)
	}
	return body.Token
}

// countOutboxEvents counts the queued mail of one kind, which is how a test says
// "and nothing was mailed" now that the RPC no longer sends anything itself.
func countOutboxEvents(t *testing.T, pg *testutil.PostgresEnv, eventType string) int {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	var count int
	if err := pg.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM outbox_events WHERE event_type = $1`, eventType).Scan(&count); err != nil {
		t.Fatalf("count %s outbox events: %v", eventType, err)
	}
	return count
}

// seedPlatformUserWithoutRole inserts a platform_users row that holds no platform
// role, the shape authentication has to reject.
func seedPlatformUserWithoutRole(t *testing.T, pg *testutil.PostgresEnv, publicID, email, name string) dbmodels.PlatformUser {
	t.Helper()

	passwordHash, err := auth.HashPassword(testutil.SeededPassword)
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	user, err := dbmodels.New(pg.DB).CreatePlatformUser(ctx, dbmodels.CreatePlatformUserParams{
		ID:           uuid.Must(uuid.NewV7()),
		PublicID:     publicID,
		Email:        email,
		PasswordHash: passwordHash,
		Name:         name,
	})
	if err != nil {
		t.Fatalf("CreatePlatformUser: %v", err)
	}
	return user
}

func platformUserByPublicID(t *testing.T, pg *testutil.PostgresEnv, publicID string) dbmodels.PlatformUser {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	user, err := dbmodels.New(pg.DB).GetPlatformUserByPublicID(ctx, publicID)
	if err != nil {
		t.Fatalf("GetPlatformUserByPublicID %s: %v", publicID, err)
	}
	return user
}

func seedTenant(t *testing.T, pg *testutil.PostgresEnv, publicID, domain, name string) uuid.UUID {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	tenant, err := dbmodels.New(pg.DB).CreateTenant(ctx, dbmodels.CreateTenantParams{
		ID:            uuid.Must(uuid.NewV7()),
		PublicID:      publicID,
		Domain:        domain,
		AdminDomain:   nullableString("admin-" + domain),
		Name:          name,
		Timezone:      tenanttz.Default,
		DefaultLocale: "ja",
	})
	if err != nil {
		t.Fatalf("CreateTenant %s: %v", publicID, err)
	}
	return tenant.ID
}

// seedEndUser inserts a user that holds no tenant role, which is what the platform
// console calls an end user.
func seedEndUser(t *testing.T, pg *testutil.PostgresEnv, tenantID uuid.UUID, publicID, email, name string) dbmodels.User {
	t.Helper()

	passwordHash, err := auth.HashPassword(testutil.SeededPassword)
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	user, err := dbmodels.New(pg.DB).CreateUser(ctx, dbmodels.CreateUserParams{
		ID:           uuid.Must(uuid.NewV7()),
		TenantID:     uuid.NullUUID{UUID: tenantID, Valid: true},
		PublicID:     publicID,
		Email:        email,
		PasswordHash: passwordHash,
		Name:         name,
	})
	if err != nil {
		t.Fatalf("CreateUser %s: %v", publicID, err)
	}
	return user
}

// seedTenantMember turns a seeded user into a tenant member; platform end-user
// management must refuse to touch those.
func seedTenantMember(t *testing.T, pg *testutil.PostgresEnv, tenantID uuid.UUID, userID uuid.UUID, role string) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := dbmodels.New(pg.DB).CreateTenantUserRole(ctx, dbmodels.CreateTenantUserRoleParams{
		ID:       uuid.Must(uuid.NewV7()),
		TenantID: tenantID,
		UserID:   userID,
		Role:     role,
	}); err != nil {
		t.Fatalf("CreateTenantUserRole: %v", err)
	}
}

func userByPublicID(t *testing.T, pg *testutil.PostgresEnv, publicID string) (dbmodels.GetUserByPublicIDRow, bool) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	user, err := dbmodels.New(pg.DB).GetUserByPublicID(ctx, publicID)
	if err != nil {
		// Only a missing row means "deleted"; anything else would let a broken
		// query pass for a successful deletion.
		if errors.Is(err, sql.ErrNoRows) {
			return dbmodels.GetUserByPublicIDRow{}, false
		}
		t.Fatalf("GetUserByPublicID %s: %v", publicID, err)
	}
	return user, true
}

func countRows(t *testing.T, pg *testutil.PostgresEnv, query string, args ...any) int {
	t.Helper()
	return scanInt(t, pg, query, args...)
}

// scanInt runs a query that yields a single integer on the superuser connection,
// so assertions can look at rows the API never returns.
func scanInt(t *testing.T, pg *testutil.PostgresEnv, query string, args ...any) int {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var value int
	if err := pg.DB.QueryRowContext(ctx, query, args...).Scan(&value); err != nil {
		t.Fatalf("query %q: %v", query, err)
	}
	return value
}
