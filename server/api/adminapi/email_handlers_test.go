package adminapi

import (
	"bytes"
	"context"
	"database/sql"
	"log/slog"
	"net/http/httptest"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/emailsettings"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/secretcrypto"
)

type adminSMTPTesterStub struct {
	settings  emailsettings.SMTPSettings
	recipient string
	err       error
}

func (s *adminSMTPTesterStub) SendTestEmail(_ context.Context, settings emailsettings.SMTPSettings, recipient string) error {
	s.settings = settings
	s.recipient = recipient
	return s.err
}

func newAdminTestEncryptor(t *testing.T) *secretcrypto.Manager {
	t.Helper()
	mgr, err := secretcrypto.NewManager(map[string][]byte{"k1": bytes.Repeat([]byte{2}, 32)}, "k1")
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	return mgr
}

func tenantSMTPColumns() []string {
	return []string{"tenant_id", "smtp_override_enabled", "host", "port", "username", "password_encrypted", "encryption", "from_name", "from_address", "reply_to", "created_at", "updated_at"}
}

func TestGetTenantEmailSettingsRejectsEditorRole(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)

	client := publiraadminv1connect.NewAdminEmailSettingsServiceClient(ts.Client(), ts.URL)
	req := connect.NewRequest(&publiraadminv1.GetTenantEmailSettingsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)
	_, err := client.GetTenantEmailSettings(context.Background(), req)
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("GetTenantEmailSettings code = %v, want permission_denied", connect.CodeOf(err))
	}
	assertExpectations(t, mock)
}

func TestUpdateTenantEmailSettingsDisabledPreservesStoredValues(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	encrypted := "enc:tenant:stored"
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantSMTPConfigByTenantID)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows(tenantSMTPColumns()).
			AddRow(tenantID, false, "smtp.saved.example", 465, "saved-user", encrypted, "tls", "Saved Sender", "saved@example.com", "reply@example.com", now, now))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.UpsertTenantSMTPConfig)).
		WithArgs(
			tenantID,
			false,
			sql.NullString{String: "smtp.saved.example", Valid: true},
			sql.NullInt32{Int32: 465, Valid: true},
			sql.NullString{String: "saved-user", Valid: true},
			sql.NullString{String: encrypted, Valid: true},
			sql.NullString{String: "tls", Valid: true},
			sql.NullString{String: "Saved Sender", Valid: true},
			sql.NullString{String: "saved@example.com", Valid: true},
			sql.NullString{String: "reply@example.com", Valid: true},
		).
		WillReturnRows(sqlmock.NewRows(tenantSMTPColumns()).
			AddRow(tenantID, false, "smtp.saved.example", 465, "saved-user", encrypted, "tls", "Saved Sender", "saved@example.com", "reply@example.com", now, now))
	expectAdminAuditLogInsert(mock)

	client := publiraadminv1connect.NewAdminEmailSettingsServiceClient(ts.Client(), ts.URL)
	req := connect.NewRequest(&publiraadminv1.UpdateTenantEmailSettingsRequest{
		Tenant:              &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		SmtpOverrideEnabled: false,
		PasswordUpdateMode:  publiraadminv1.SecretUpdateMode_SECRET_UPDATE_MODE_UNCHANGED,
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)
	resp, err := client.UpdateTenantEmailSettings(context.Background(), req)
	if err != nil {
		t.Fatalf("UpdateTenantEmailSettings: %v", err)
	}
	if resp.Msg.Settings.Host != "smtp.saved.example" {
		t.Fatalf("settings.host = %q, want smtp.saved.example", resp.Msg.Settings.Host)
	}
	if !resp.Msg.Settings.HasPassword {
		t.Fatal("settings.has_password = false, want true")
	}
	assertExpectations(t, mock)
}

// A tenant that overrides nothing has no SMTP settings of its own to test: its
// mail leaves over the platform relay, and the admin database role must not be
// able to read those credentials. The request is refused before any query runs.
func TestSendTenantSmtpTestEmailRefusesWhenOverrideDisabled(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	tester := &adminSMTPTesterStub{}
	handler, err := newTestHandler(db, dbmodels.New(db), &testStorageProvider{}, slog.Default(), newAdminTestEncryptor(t), tester)
	if err != nil {
		t.Fatalf("new admin handler: %v", err)
	}
	ts := httptest.NewServer(handler)
	t.Cleanup(ts.Close)

	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")

	client := publiraadminv1connect.NewAdminEmailSettingsServiceClient(ts.Client(), ts.URL)
	req := connect.NewRequest(&publiraadminv1.SendTenantSmtpTestEmailRequest{
		Tenant:              &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		RecipientType:       publiraadminv1.TestEmailRecipientType_TEST_EMAIL_RECIPIENT_TYPE_SELF,
		SmtpOverrideEnabled: false,
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)
	if _, err := client.SendTenantSmtpTestEmail(context.Background(), req); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("SendTenantSmtpTestEmail code = %v, want failed_precondition", connect.CodeOf(err))
	}
	if tester.recipient != "" {
		t.Fatalf("tester.recipient = %q, want no test message sent", tester.recipient)
	}
	assertExpectations(t, mock)
}
