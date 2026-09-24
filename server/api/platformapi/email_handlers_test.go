package platformapi

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

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
	return []string{"singleton", "host", "port", "username", "password_encrypted", "encryption", "from_address", "reply_to", "created_at", "updated_at", "revision"}
}

func newEmailSettingsActorContext() context.Context {
	return context.WithValue(context.Background(), platformActorContextKey{}, platformActor{
		UserID: uuid.Must(uuid.NewV7()),
		Role:   "platform_operator",
		Email:  "platform@example.com",
	})
}

// emailUpdateRequest keeps the stored password, which is the save a form that
// was opened before another session's password change would send.
func emailUpdateRequest(revision int64) *publirasplatformv1.UpdatePlatformEmailSettingsRequest {
	return &publirasplatformv1.UpdatePlatformEmailSettingsRequest{
		Host:               "smtp.example.com",
		Port:               587,
		Username:           "mailer",
		PasswordUpdateMode: publirasplatformv1.SecretUpdateMode_SECRET_UPDATE_MODE_UNCHANGED,
		Encryption:         "starttls",
		FromAddress:        "no-reply@example.com",
		ReplyTo:            "reply@example.com",
		ExpectedRevision:   revision,
	}
}

func TestGetPlatformEmailSettingsDatabaseErrorIsHidden(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetPlatformSMTPConfig)).
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
	existingEncrypted, err := server.encryptor.EncryptString("existing-secret")
	if err != nil {
		t.Fatalf("EncryptString: %v", err)
	}

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.LockPlatformSMTPConfig)).
		WillReturnRows(sqlmock.NewRows(platformSMTPColumns()).
			AddRow(true, "smtp.old.example", 587, "old-user", existingEncrypted, "starttls", "old@example.com", "reply-old@example.com", now, now, 3))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.UpdatePlatformSMTPConfig)).
		WithArgs("smtp.example.com", int32(587), "mailer", existingEncrypted, "starttls", "no-reply@example.com", sql.NullString{String: "reply@example.com", Valid: true}).
		WillReturnRows(sqlmock.NewRows(platformSMTPColumns()).
			AddRow(true, "smtp.example.com", 587, "mailer", existingEncrypted, "starttls", "no-reply@example.com", "reply@example.com", now, now, 4))
	mock.ExpectCommit()
	expectOperatorAuditLogInsert(mock)

	resp, err := server.UpdatePlatformEmailSettings(newEmailSettingsActorContext(), connect.NewRequest(emailUpdateRequest(3)))
	if err != nil {
		t.Fatalf("UpdatePlatformEmailSettings: %v", err)
	}
	if !resp.Msg.Settings.HasPassword {
		t.Fatal("settings.has_password = false, want true")
	}
	if resp.Msg.Settings.ReplyTo != "reply@example.com" {
		t.Fatalf("settings.reply_to = %q, want reply@example.com", resp.Msg.Settings.ReplyTo)
	}
	if resp.Msg.Settings.Revision != 4 {
		t.Fatalf("settings.revision = %d, want 4", resp.Msg.Settings.Revision)
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestUpdatePlatformEmailSettingsRejectsAStaleRevision(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	server.encryptor = newTestEncryptor(t)
	now := time.Now()
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.LockPlatformSMTPConfig)).
		WillReturnRows(sqlmock.NewRows(platformSMTPColumns()).
			AddRow(true, "smtp.example.com", 587, "mailer", "enc:v1:k1:nonce:replaced", "starttls", "no-reply@example.com", "reply@example.com", now, now, 4))
	mock.ExpectRollback()

	_, err := server.UpdatePlatformEmailSettings(newEmailSettingsActorContext(), connect.NewRequest(emailUpdateRequest(3)))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("UpdatePlatformEmailSettings code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}
	// No update and no audit entry: the conflict is refused before anything is
	// written.
	assertOperatorHandlerExpectations(t, mock)
}

// Revision zero states that no settings row is expected yet, which is the only
// way one gets created here.
func TestUpdatePlatformEmailSettingsCreatesTheRowForRevisionZero(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	server.encryptor = newTestEncryptor(t)
	now := time.Now()
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.LockPlatformSMTPConfig)).WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.InsertPlatformSMTPConfig)).
		WithArgs("smtp.example.com", int32(587), "mailer", sqlmock.AnyArg(), "starttls", "no-reply@example.com", sql.NullString{String: "reply@example.com", Valid: true}).
		WillReturnRows(sqlmock.NewRows(platformSMTPColumns()).
			AddRow(true, "smtp.example.com", 587, "mailer", "enc:v1:k1:nonce:ciphertext", "starttls", "no-reply@example.com", "reply@example.com", now, now, 1))
	mock.ExpectCommit()
	expectOperatorAuditLogInsert(mock)

	req := emailUpdateRequest(0)
	req.PasswordUpdateMode = publirasplatformv1.SecretUpdateMode_SECRET_UPDATE_MODE_REPLACE
	req.Password = "new-secret"
	resp, err := server.UpdatePlatformEmailSettings(newEmailSettingsActorContext(), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("UpdatePlatformEmailSettings: %v", err)
	}
	if resp.Msg.Settings.Revision != 1 {
		t.Fatalf("settings.revision = %d, want 1", resp.Msg.Settings.Revision)
	}
	assertOperatorHandlerExpectations(t, mock)
}

// A revision other than zero was read from a row, so finding none means it was
// deleted, and recreating it would bring back values nobody confirmed.
func TestUpdatePlatformEmailSettingsRejectsARevisionWhenNoRowExists(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	server.encryptor = newTestEncryptor(t)
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.LockPlatformSMTPConfig)).WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()

	req := emailUpdateRequest(2)
	req.PasswordUpdateMode = publirasplatformv1.SecretUpdateMode_SECRET_UPDATE_MODE_REPLACE
	req.Password = "new-secret"
	_, err := server.UpdatePlatformEmailSettings(newEmailSettingsActorContext(), connect.NewRequest(req))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("UpdatePlatformEmailSettings code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestUpdatePlatformEmailSettingsReportsALostInsertRaceAsAConflict(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	server.encryptor = newTestEncryptor(t)
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.LockPlatformSMTPConfig)).WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.InsertPlatformSMTPConfig)).
		WillReturnError(&pgconn.PgError{Code: "23505", ConstraintName: "platform_smtp_config_pkey"})
	mock.ExpectRollback()

	req := emailUpdateRequest(0)
	req.PasswordUpdateMode = publirasplatformv1.SecretUpdateMode_SECRET_UPDATE_MODE_REPLACE
	req.Password = "new-secret"
	_, err := server.UpdatePlatformEmailSettings(newEmailSettingsActorContext(), connect.NewRequest(req))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("UpdatePlatformEmailSettings code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestUpdatePlatformEmailSettingsRejectsANegativeRevision(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)

	_, err := server.UpdatePlatformEmailSettings(newEmailSettingsActorContext(), connect.NewRequest(emailUpdateRequest(-1)))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("UpdatePlatformEmailSettings code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	// Rejected before the transaction is opened at all.
	assertOperatorHandlerExpectations(t, mock)
}

func TestSendPlatformSmtpTestEmailWithoutSecretManagerReportsUnavailable(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	server.tester = &smtpTesterStub{}
	now := time.Now()
	actorID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetPlatformSMTPConfig)).
		WillReturnRows(sqlmock.NewRows(platformSMTPColumns()).
			AddRow(true, "smtp.example.com", 587, "mailer", "enc:v1:k1:nonce:ciphertext", "starttls", "no-reply@example.com", "reply@example.com", now, now, 1))

	ctx := context.WithValue(context.Background(), platformActorContextKey{}, platformActor{
		UserID: actorID,
		Role:   "platform_operator",
		Email:  "operator@example.com",
	})
	_, err := server.SendPlatformSmtpTestEmail(ctx, connect.NewRequest(&publirasplatformv1.SendPlatformSmtpTestEmailRequest{
		RecipientType:      publirasplatformv1.TestEmailRecipientType_TEST_EMAIL_RECIPIENT_TYPE_SELF,
		Host:               "smtp.example.com",
		Port:               587,
		Username:           "mailer",
		PasswordUpdateMode: publirasplatformv1.SecretUpdateMode_SECRET_UPDATE_MODE_UNCHANGED,
		Encryption:         "starttls",
		FromAddress:        "no-reply@example.com",
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("SendPlatformSmtpTestEmail code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}
	if !errors.Is(err, emailsettings.ErrSecretManagerUnavailable) {
		t.Fatalf("SendPlatformSmtpTestEmail error = %v, want ErrSecretManagerUnavailable", err)
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestSendPlatformSmtpTestEmailUsesRequestSettings(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	server.encryptor = newTestEncryptor(t)
	tester := &smtpTesterStub{}
	server.tester = tester
	actorID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetPlatformSMTPConfig)).WillReturnError(sql.ErrNoRows)
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
