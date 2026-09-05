package platformapi

import (
	"database/sql/driver"
	"log/slog"
	"net/http/httptest"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publirasplatformv1 "github.com/publira/publira/server/internal/gen/publira/platform/v1"
	"github.com/publira/publira/server/internal/publicid"
	"github.com/publira/publira/server/internal/testutil"
)

const (
	// Platform operators and authentication.
	testGetPlatformUserByPublicIDQuery          = "-- name: GetPlatformUserByPublicID :one\n"
	testGetPlatformUserByIDQuery                = "-- name: GetPlatformUserByID :one\n"
	testGetPlatformUserByEmailQuery             = "-- name: GetPlatformUserByEmail :one\n"
	testCreatePlatformUserPasswordResetToken    = "-- name: CreatePlatformUserPasswordResetToken :one\n"
	testDeletePlatformUserPasswordResetTokens   = "-- name: DeletePlatformUserPasswordResetTokensByUserID :exec\n"
	testGetPlatformPasswordResetTokenByHash     = "-- name: GetPlatformUserPasswordResetTokenByHash :one\n"
	testMarkPlatformPasswordResetTokenCompleted = "-- name: MarkPlatformUserPasswordResetTokenCompleted :exec\n"
	testCreatePlatformEmailChangeToken          = "-- name: CreatePlatformUserEmailChangeToken :one\n"
	testDeletePlatformEmailChangeTokens         = "-- name: DeletePlatformUserEmailChangeTokensByUserID :exec\n"
	testGetPlatformEmailChangeTokenByHash       = "-- name: GetPlatformUserEmailChangeTokenByHash :one\n"
	testMarkPlatformEmailChangeCurrentConfirmed = "-- name: MarkPlatformUserEmailChangeCurrentEmailConfirmed :exec\n"
	testMarkPlatformEmailChangeNewConfirmed     = "-- name: MarkPlatformUserEmailChangeNewEmailConfirmed :exec\n"
	testMarkPlatformEmailChangeCompleted        = "-- name: MarkPlatformUserEmailChangeCompleted :exec\n"
	testListPlatformUserRolesQuery              = "-- name: ListPlatformUserRoles :many\n"
	testCreatePlatformUserQuery                 = "-- name: CreatePlatformUser :one\n"
	testCreatePlatformUserRoleQuery             = "-- name: CreatePlatformUserRole :one\n"
	testGetPlatformOperatorByPublicIDQuery      = "-- name: GetPlatformOperatorByPublicID :one\n"
	testDeletePlatformUserRolesByPlatformUserID = "-- name: DeletePlatformUserRolesByPlatformUserID :exec\n"
	testUpdatePlatformUserPasswordHashByID      = "-- name: UpdatePlatformUserPasswordHashByID :one\n"
	testUpdatePlatformUserEmailByID             = "-- name: UpdatePlatformUserEmailByID :one\n"
	testUpdatePlatformUserStatusQuery           = "-- name: UpdatePlatformUserStatus :one\n"
	testBumpPlatformUserCredentialsVersionQuery = "-- name: BumpPlatformUserCredentialsVersion :one\n"
	testPlatformSessionToken                    = "platform-session-token"

	// Tenant members.
	testGetTenantByPublicIDQuery           = "-- name: GetTenantByPublicID :one\n"
	testGetUserByEmailForTenantQuery       = "-- name: GetUserByEmailForTenant :one\n"
	testGetUserByPublicIDForTenantQuery    = "-- name: GetUserByPublicIDForTenant :one\n"
	testListTenantUserRolesQuery           = "-- name: ListTenantUserRoles :many\n"
	testCreateTenantUserRoleQuery          = "-- name: CreateTenantUserRole :one\n"
	testDeleteTenantUserRolesByUserIDQuery = "-- name: DeleteTenantUserRolesByUserID :exec\n"
	testListTenantMembersDescQuery         = "-- name: ListTenantMembersDesc :many\n"
	testListTenantMembersAscQuery          = "-- name: ListTenantMembersAsc :many\n"
	testGetPlatformSMTPConfigQuery         = "-- name: GetPlatformSMTPConfig :one\n"
	testInsertOutboxEventQuery             = "-- name: InsertOutboxEvent :one\n"
	testUpsertPlatformSMTPConfigQuery      = "-- name: UpsertPlatformSMTPConfig :one\n"

	// Platform-wide settings.
	testGetPlatformConfigQuery           = "-- name: GetPlatformConfig :one\n"
	testUpsertPlatformSettingsQuery      = "-- name: UpsertPlatformSettings :one\n"
	testUpsertPlatformDefaultLocaleQuery = "-- name: UpsertPlatformDefaultLocale :one\n"

	// End users.
	testListEndUsersDescQuery           = "-- name: ListEndUsersDesc :many\n"
	testListEndUsersAscQuery            = "-- name: ListEndUsersAsc :many\n"
	testGetUserByPublicIDQuery          = "-- name: GetUserByPublicID :one\n"
	testGetTenantByUserIDQuery          = "-- name: GetTenantByUserID :one\n"
	testUpdateUserStatusQuery           = "-- name: UpdateUserStatus :one\n"
	testBumpUserCredentialsVersionQuery = "-- name: BumpUserCredentialsVersion :one\n"
	testDeleteUserByIDQuery             = "-- name: DeleteUserByID :exec\n"
)

func newOperatorHandlerTestServer(t *testing.T) (*platformServer, sqlmock.Sqlmock) {
	t.Helper()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	queries := dbmodels.New(db)
	return &platformServer{
		queries:  queries,
		db:       db,
		recorder: auditlog.New(queries, slog.Default()),
		tokens:   testutil.TokenManager(),
		logger:   slog.Default(),
	}, mock
}

func operatorTestUserColumns() []string {
	return []string{"id", "public_id", "email", "password_hash", "name", "status", "created_at", "credentials_version"}
}

func issueTestPlatformToken(userPublicID, role string) string {
	token, _, err := testutil.TokenManager().Issue(
		userPublicID,
		auth.AudiencePlatform,
		"",
		role,
		1,
		time.Now(),
	)
	if err != nil {
		panic(err)
	}
	return token
}

func operatorTestColumns() []string {
	return []string{"id", "public_id", "email", "name", "role", "status", "created_at"}
}

func newAuthedOperatorRequest[T any](msg *T) *connect.Request[T] {
	req := connect.NewRequest(msg)
	req.Header().Set("Authorization", "Bearer "+issueTestPlatformToken("PLATUSER001", "platform_operator"))
	return req
}

func expectOperatorAuth(mock sqlmock.Sqlmock, userID uuid.UUID, role string, now time.Time) {
	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformUserByPublicIDQuery)).
		WithArgs("PLATUSER001").
		WillReturnRows(sqlmock.NewRows(operatorTestUserColumns()).
			AddRow(userID, "PLATUSER001", "platform@example.com", "hashed", "Platform User", "active", now, int32(1)))

	mock.ExpectQuery(regexp.QuoteMeta(testListPlatformUserRolesQuery)).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow(role))
}

func expectOperatorAuditLogInsert(mock sqlmock.Sqlmock) {
	mock.ExpectExec("INSERT INTO platform_audit_logs").
		WillReturnResult(sqlmock.NewResult(0, 1))
}

func assertOperatorHandlerExpectations(t *testing.T, mock sqlmock.Sqlmock) {
	t.Helper()
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

// HTTP/Connect Integration Test Helpers

// Constants for HTTP integration tests (Connect RPC via NewHandler)
const (
	integrationListTenantsQuery              = "-- name: ListTenantsDesc :many\n"
	integrationCreateTenantQuery             = "-- name: CreateTenant :one\n"
	integrationUpdateTenantStatusQuery       = "-- name: UpdateTenantStatus :one\n"
	integrationListPlatformOperatorsQuery    = "-- name: ListPlatformOperatorsDesc :many\n"
	integrationCountAllTenantsQuery          = "-- name: CountAllTenants :one\n"
	integrationCountActiveTenantsQuery       = "-- name: CountActiveTenants :one\n"
	integrationCountSuspendedTenantsQuery    = "-- name: CountSuspendedTenants :one\n"
	integrationCountPendingEndUsersQuery     = "-- name: CountPendingEndUsers :one\n"
	integrationListRecentPlatformEventsQuery = "-- name: ListRecentPlatformEvents :many\n"
	integrationListPlatformAuditLogsQuery    = "-- name: ListPlatformAuditLogsDesc :many\n"
	integrationListPlatformAuditLogsAscQuery = "-- name: ListPlatformAuditLogsAsc :many\n"
	integrationSessionToken                  = "platform-session-token"
	integrationPlatformRole                  = "platform_operator"
)

func integrationTenantColumns() []string {
	return []string{"id", "public_id", "domain", "name", "default_reading_period_hours", "created_at", "status", "admin_domain", "timezone", "default_locale"}
}

func platformConfigColumns() []string {
	return []string{"singleton", "default_timezone", "default_locale", "created_at", "updated_at"}
}

// expectPlatformConfigLookup expects the read of the platform settings row and
// answers it with the given default time zone and locale.
func expectPlatformConfigLookup(mock sqlmock.Sqlmock, defaultTimezone, defaultLocale string, now time.Time) {
	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformConfigQuery)).
		WillReturnRows(sqlmock.NewRows(platformConfigColumns()).AddRow(true, defaultTimezone, defaultLocale, now, now))
}

func integrationOperatorColumns() []string {
	return []string{"id", "public_id", "email", "name", "role", "status", "created_at"}
}

func newIntegrationTestServer(t *testing.T) (*httptest.Server, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	server := httptest.NewServer(NewHandler(db, dbmodels.New(db), slog.Default(), nil, nil, testutil.TokenManager()))
	t.Cleanup(server.Close)
	return server, mock
}

func newIntegrationRequest[T any](msg T) *connect.Request[T] {
	return connect.NewRequest(&msg)
}

func newAuthedIntegrationRequest[T any](msg T) *connect.Request[T] {
	req := connect.NewRequest(&msg)
	req.Header().Set("Authorization", "Bearer "+issueTestPlatformToken("PLATUSER001", integrationPlatformRole))
	return req
}

func newAuthedCreateTenantIntegrationRequest(msg *publirasplatformv1.CreateTenantRequest) *connect.Request[publirasplatformv1.CreateTenantRequest] {
	req := connect.NewRequest(msg)
	req.Header().Set("Authorization", "Bearer "+issueTestPlatformToken("PLATUSER001", integrationPlatformRole))
	return req
}

func validIntegrationCreateTenantRequest() *publirasplatformv1.CreateTenantRequest {
	return &publirasplatformv1.CreateTenantRequest{
		DefaultLocale:      "ja",
		Name:               "New Tenant",
		Domain:             "new.example.com",
		InitialAdminEmails: []string{"owner@example.com"},
	}
}

func expectIntegrationAuth(mock sqlmock.Sqlmock, tenantID, userID uuid.UUID, role string, now time.Time) {
	_ = tenantID
	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformUserByPublicIDQuery)).
		WithArgs("PLATUSER001").
		WillReturnRows(sqlmock.NewRows(operatorTestUserColumns()).
			AddRow(userID, "PLATUSER001", "platform@example.com", "hashed", "Platform User", "active", now, int32(1)))

	mock.ExpectQuery(regexp.QuoteMeta(testListPlatformUserRolesQuery)).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow(role))
}

func assertIntegrationExpectations(t *testing.T, mock sqlmock.Sqlmock) {
	t.Helper()
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func expectIntegrationAuditLogInsert(mock sqlmock.Sqlmock) {
	mock.ExpectExec("INSERT INTO platform_audit_logs").
		WillReturnResult(sqlmock.NewResult(0, 1))
}

func duplicatePublicIDError() error {
	return &pgconn.PgError{Code: "23505", ConstraintName: "tenants_public_id_key"}
}

// expectPublicIDAttempt expects the savepoint publicid.InsertTx takes before an
// insert, followed by its release on success or its rollback on a collision.
func expectPublicIDAttempt(mock sqlmock.Sqlmock) {
	mock.ExpectExec("^SAVEPOINT publira_public_id$").WillReturnResult(sqlmock.NewResult(0, 0))
}

func expectPublicIDAttemptReleased(mock sqlmock.Sqlmock) {
	mock.ExpectExec("^RELEASE SAVEPOINT publira_public_id$").WillReturnResult(sqlmock.NewResult(0, 0))
}

func expectPublicIDAttemptRolledBack(mock sqlmock.Sqlmock) {
	mock.ExpectExec("^ROLLBACK TO SAVEPOINT publira_public_id$").WillReturnResult(sqlmock.NewResult(0, 0))
}

// publicIDArgument matches any string argument and records what was passed, so
// a test can assert on the public IDs the handler generated.
type publicIDArgument struct {
	values []string
}

func (a *publicIDArgument) Match(v driver.Value) bool {
	value, ok := v.(string)
	if !ok {
		return false
	}
	a.values = append(a.values, value)

	return true
}

// assertRetriedWithFreshPublicIDs checks that a retry did not reuse the ID that
// just collided; reusing it would hit the same unique constraint again.
func assertRetriedWithFreshPublicIDs(t *testing.T, attempted *publicIDArgument, want int) {
	t.Helper()

	if len(attempted.values) != want {
		t.Fatalf("public_id attempts = %v, want %d", attempted.values, want)
	}
	seen := make(map[string]struct{}, want)
	for _, value := range attempted.values {
		if !publicid.Valid(value) {
			t.Fatalf("generated public_id %q is not 12 Base58 characters", value)
		}
		if _, duplicate := seen[value]; duplicate {
			t.Fatalf("retry reused public_id %q", value)
		}
		seen[value] = struct{}{}
	}
}

func duplicateDomainError() error {
	return &pgconn.PgError{Code: "23505", ConstraintName: "tenants_domain_key"}
}

func duplicateAdminDomainError() error {
	return &pgconn.PgError{Code: "23505", ConstraintName: "tenants_admin_domain_key"}
}
