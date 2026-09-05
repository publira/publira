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
	publiraadminv1 "github.com/publira/publira/server/internal/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/testutil"
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

func platformSMTPColumnsForAdmin() []string {
	return []string{"singleton", "host", "port", "username", "password_encrypted", "encryption", "from_address", "reply_to", "created_at", "updated_at"}
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
	mock.ExpectQuery(regexp.QuoteMeta(getTenantSMTPConfigByTenantIDQuery)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows(tenantSMTPColumns()).
			AddRow(tenantID, false, "smtp.saved.example", 465, "saved-user", encrypted, "tls", "Saved Sender", "saved@example.com", "reply@example.com", now, now))
	mock.ExpectQuery(regexp.QuoteMeta(upsertTenantSMTPConfigQuery)).
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

func TestSendTenantSmtpTestEmailUsesPlatformFallbackWhenOverrideDisabled(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	encryptor := newAdminTestEncryptor(t)
	tester := &adminSMTPTesterStub{}
	ts := httptest.NewServer(NewHandler(db, dbmodels.New(db), &testStorageProvider{}, slog.Default(), encryptor, tester, testutil.TokenManager()))
	t.Cleanup(ts.Close)

	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	encrypted, err := encryptor.EncryptString("platform-secret")
	if err != nil {
		t.Fatalf("EncryptString: %v", err)
	}

	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")
	mock.ExpectQuery(regexp.QuoteMeta(getPlatformSMTPConfigQuery)).
		WillReturnRows(sqlmock.NewRows(platformSMTPColumnsForAdmin()).
			AddRow(true, "smtp.platform.example", 587, "platform-user", encrypted, "starttls", "platform@example.com", "help@example.com", now, now))
	expectAdminAuditLogInsert(mock)

	client := publiraadminv1connect.NewAdminEmailSettingsServiceClient(ts.Client(), ts.URL)
	req := connect.NewRequest(&publiraadminv1.SendTenantSmtpTestEmailRequest{
		Tenant:              &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		RecipientType:       publiraadminv1.TestEmailRecipientType_TEST_EMAIL_RECIPIENT_TYPE_SELF,
		SmtpOverrideEnabled: false,
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)
	resp, err := client.SendTenantSmtpTestEmail(context.Background(), req)
	if err != nil {
		t.Fatalf("SendTenantSmtpTestEmail: %v", err)
	}
	if resp.Msg.RecipientEmail != "user@example.com" {
		t.Fatalf("recipient_email = %q, want user@example.com", resp.Msg.RecipientEmail)
	}
	if tester.recipient != "user@example.com" {
		t.Fatalf("tester.recipient = %q, want user@example.com", tester.recipient)
	}
	if tester.settings.Host != "smtp.platform.example" || tester.settings.Password != "platform-secret" {
		t.Fatalf("tester settings = %#v, want platform fallback settings", tester.settings)
	}
	assertExpectations(t, mock)
}
