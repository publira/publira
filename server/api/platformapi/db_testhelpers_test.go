package platformapi

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/emailsettings"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
	"github.com/publira/publira/server/internal/tenanttz"
	"github.com/publira/publira/server/internal/testutil"
)

// newDBIntegrationEnv resets the shared PostgreSQL (Testcontainers) and starts an
// httptest server talking to it as publira_platform. Nothing is seeded, so tests
// that need operators or end users seed them through the returned env.
func newDBIntegrationEnv(t *testing.T) (*httptest.Server, *testutil.PostgresEnv) {
	t.Helper()
	return newDBIntegrationEnvWithSMTP(t, nil, nil)
}

// newDBIntegrationEnvWithMailer is newDBIntegrationEnv plus a recording mailer and
// a stored platform SMTP config, so flows that send mail (password reset, email
// change) run end to end without a real SMTP server.
func newDBIntegrationEnvWithMailer(t *testing.T) (*httptest.Server, *testutil.PostgresEnv, *recordingMailer) {
	t.Helper()

	encryptor := newTestEncryptor(t)
	mailer := &recordingMailer{}
	server, pg := newDBIntegrationEnvWithSMTP(t, encryptor, mailer)
	seedPlatformSMTPConfig(t, pg, encryptor)
	return server, pg, mailer
}

func newDBIntegrationEnvWithSMTP(
	t *testing.T,
	encryptor emailsettings.SecretManager,
	mailer *recordingMailer,
) (*httptest.Server, *testutil.PostgresEnv) {
	t.Helper()

	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	db := pg.OpenPlatformDB(t)

	// NewHandler wires a mailer whenever the tester is non-nil and also implements
	// smtp.Sender, so a missing mailer has to stay a nil interface value — a typed
	// nil pointer would be taken for a configured sender.
	var tester internalsmtp.Tester
	if mailer != nil {
		tester = mailer
	}
	server := httptest.NewServer(NewHandler(db, dbmodels.New(db), slog.Default(), encryptor, tester, nil, testutil.TokenManager()))
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

// recordingMailer stands in for the SMTP client: it keeps whatever the handlers
// would have sent so tests can pull confirmation tokens out of the mail body.
type recordingMailer struct {
	mu       sync.Mutex
	messages []recordedEmail
}

type recordedEmail struct {
	Recipient string
	Subject   string
	Body      string
}

func (m *recordingMailer) SendTestEmail(_ context.Context, _ emailsettings.SMTPSettings, recipient string) error {
	return m.record(recordedEmail{Recipient: recipient, Subject: "test"})
}

func (m *recordingMailer) SendEmail(
	_ context.Context,
	_ emailsettings.SMTPSettings,
	recipient, subject, body string,
) error {
	return m.record(recordedEmail{Recipient: recipient, Subject: subject, Body: body})
}

func (m *recordingMailer) record(message recordedEmail) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.messages = append(m.messages, message)
	return nil
}

func (m *recordingMailer) sent() []recordedEmail {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]recordedEmail(nil), m.messages...)
}

func (m *recordingMailer) sentTo(t *testing.T, recipient string) recordedEmail {
	t.Helper()
	for _, message := range m.sent() {
		if message.Recipient == recipient {
			return message
		}
	}
	t.Fatalf("no email sent to %s (sent: %+v)", recipient, m.sent())
	return recordedEmail{}
}

// tokenFromConfirmationEmail pulls the ?token= value out of the confirmation URL
// the handler embedded in the mail body.
func tokenFromConfirmationEmail(t *testing.T, message recordedEmail) string {
	t.Helper()
	for _, field := range strings.Fields(message.Body) {
		if !strings.Contains(field, "token=") {
			continue
		}
		parsed, err := url.Parse(field)
		if err != nil {
			continue
		}
		if token := parsed.Query().Get("token"); token != "" {
			return token
		}
	}
	t.Fatalf("no confirmation token in email body: %q", message.Body)
	return ""
}

func seedPlatformSMTPConfig(t *testing.T, pg *testutil.PostgresEnv, encryptor emailsettings.SecretManager) {
	t.Helper()

	encrypted, err := encryptor.EncryptString("smtp-password")
	if err != nil {
		t.Fatalf("EncryptString: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := dbmodels.New(pg.DB).UpsertPlatformSMTPConfig(ctx, dbmodels.UpsertPlatformSMTPConfigParams{
		Host:              "smtp.example.com",
		Port:              587,
		Username:          "mailer",
		PasswordEncrypted: encrypted,
		Encryption:        "starttls",
		FromAddress:       "no-reply@example.com",
	}); err != nil {
		t.Fatalf("UpsertPlatformSMTPConfig: %v", err)
	}
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
