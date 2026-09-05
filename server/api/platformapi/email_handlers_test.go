package platformapi

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/emailsettings"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	publirasplatformv1connect "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1/publirasplatformv1connect"
	"github.com/publira/publira/server/internal/secretcrypto"
)

type smtpTesterStub struct {
	settings  emailsettings.SMTPSettings
	recipient string
	err       error
}

func (s *smtpTesterStub) SendTestEmail(_ context.Context, settings emailsettings.SMTPSettings, recipient string) error {
	s.settings = settings
	s.recipient = recipient
	return s.err
}

func newTestEncryptor(t *testing.T) *secretcrypto.Manager {
	t.Helper()
	mgr, err := secretcrypto.NewManager(map[string][]byte{"k1": bytes.Repeat([]byte{1}, 32)}, "k1")
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	return mgr
}

func platformSMTPColumns() []string {
	return []string{"singleton", "host", "port", "username", "password_encrypted", "encryption", "from_address", "reply_to", "created_at", "updated_at"}
}

func TestGetPlatformEmailSettingsDatabaseErrorIsHidden(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformSMTPConfigQuery)).
		WillReturnError(errors.New(`pq: relation "platform_smtp_configs" does not exist`))

	_, err := server.GetPlatformEmailSettings(context.Background(), connect.NewRequest(&publirasplatformv1.GetPlatformEmailSettingsRequest{}))
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("GetPlatformEmailSettings code = %v, want %v", connect.CodeOf(err), connect.CodeInternal)
	}
	if err.Error() != "internal: internal server error" {
		t.Fatalf("error = %q, want database details hidden", err)
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestUpdatePlatformEmailSettingsKeepsExistingPassword(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	server.encryptor = newTestEncryptor(t)
	now := time.Now()
	actorID := uuid.Must(uuid.NewV7())
	existingEncrypted, err := server.encryptor.EncryptString("existing-secret")
	if err != nil {
		t.Fatalf("EncryptString: %v", err)
	}

	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformSMTPConfigQuery)).
		WillReturnRows(sqlmock.NewRows(platformSMTPColumns()).
			AddRow(true, "smtp.old.example", 587, "old-user", existingEncrypted, "starttls", "old@example.com", "reply-old@example.com", now, now))
	mock.ExpectQuery(regexp.QuoteMeta(testUpsertPlatformSMTPConfigQuery)).
		WithArgs("smtp.example.com", int32(587), "mailer", existingEncrypted, "starttls", "no-reply@example.com", sql.NullString{String: "reply@example.com", Valid: true}).
		WillReturnRows(sqlmock.NewRows(platformSMTPColumns()).
			AddRow(true, "smtp.example.com", 587, "mailer", existingEncrypted, "starttls", "no-reply@example.com", "reply@example.com", now, now))
	expectOperatorAuditLogInsert(mock)

	ctx := context.WithValue(context.Background(), platformActorContextKey{}, platformActor{
		UserID: actorID,
		Role:   "platform_operator",
		Email:  "platform@example.com",
	})
	resp, err := server.UpdatePlatformEmailSettings(ctx, connect.NewRequest(&publirasplatformv1.UpdatePlatformEmailSettingsRequest{
		Host:               "smtp.example.com",
		Port:               587,
		Username:           "mailer",
		PasswordUpdateMode: publirasplatformv1.SecretUpdateMode_SECRET_UPDATE_MODE_UNCHANGED,
		Encryption:         "starttls",
		FromAddress:        "no-reply@example.com",
		ReplyTo:            "reply@example.com",
	}))
	if err != nil {
		t.Fatalf("UpdatePlatformEmailSettings: %v", err)
	}
	if !resp.Msg.Settings.HasPassword {
		t.Fatal("settings.has_password = false, want true")
	}
	if resp.Msg.Settings.ReplyTo != "reply@example.com" {
		t.Fatalf("settings.reply_to = %q, want reply@example.com", resp.Msg.Settings.ReplyTo)
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestSendPlatformSmtpTestEmailUsesRequestSettings(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	server.encryptor = newTestEncryptor(t)
	tester := &smtpTesterStub{}
	server.tester = tester
	actorID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformSMTPConfigQuery)).WillReturnError(sql.ErrNoRows)
	expectOperatorAuditLogInsert(mock)

	ctx := context.WithValue(context.Background(), platformActorContextKey{}, platformActor{
		UserID: actorID,
		Role:   "platform_operator",
		Email:  "operator@example.com",
	})
	resp, err := server.SendPlatformSmtpTestEmail(ctx, connect.NewRequest(&publirasplatformv1.SendPlatformSmtpTestEmailRequest{
		RecipientType:      publirasplatformv1.TestEmailRecipientType_TEST_EMAIL_RECIPIENT_TYPE_SELF,
		Host:               "smtp.test.example",
		Port:               465,
		Username:           "test-user",
		PasswordUpdateMode: publirasplatformv1.SecretUpdateMode_SECRET_UPDATE_MODE_REPLACE,
		Password:           "new-secret",
		Encryption:         "tls",
		FromAddress:        "no-reply@test.example",
		ReplyTo:            "support@test.example",
	}))
	if err != nil {
		t.Fatalf("SendPlatformSmtpTestEmail: %v", err)
	}
	if resp.Msg.RecipientEmail != "operator@example.com" {
		t.Fatalf("recipient_email = %q, want operator@example.com", resp.Msg.RecipientEmail)
	}
	if tester.recipient != "operator@example.com" {
		t.Fatalf("tester.recipient = %q, want operator@example.com", tester.recipient)
	}
	settings := tester.settings
	if settings.Host != "smtp.test.example" || settings.Password != "new-secret" || settings.Encryption != "tls" {
		t.Fatalf("tester settings = %#v, want request values", settings)
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestGetPlatformEmailSettingsRejectsNonPlatformRole(t *testing.T) {
	ts, mock := newIntegrationTestServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectIntegrationAuth(mock, tenantID, userID, "tenant_admin", now)

	client := publirasplatformv1connect.NewPlatformEmailSettingsServiceClient(ts.Client(), ts.URL)
	_, err := client.GetPlatformEmailSettings(context.Background(), newAuthedIntegrationRequest(publirasplatformv1.GetPlatformEmailSettingsRequest{}))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("GetPlatformEmailSettings code = %v, want permission_denied", connect.CodeOf(err))
	}
	assertIntegrationExpectations(t, mock)
}
