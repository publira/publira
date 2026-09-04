package adminapi

import (
	"bytes"
	"context"
	"database/sql"
	"log/slog"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/paymentsettings"
	"github.com/publira/publira/server/internal/testutil"
)

const (
	testPaymentSecretKey     = "sk_test_51AdminLeakXXXX"
	testPaymentWebhookSecret = "whsec_AdminLeakYYYY"
)

func TestTenantPaymentRevalidateTags(t *testing.T) {
	tags := tenantPaymentRevalidateTags(" tenant-id ")
	if len(tags) != 1 || tags[0] != "tenant:tenant-id:site" {
		t.Fatalf("tags = %v, want [tenant:tenant-id:site]", tags)
	}
}

func tenantPaymentColumns() []string {
	return []string{
		"tenant_id", "provider", "enabled",
		"secret_key_encrypted", "webhook_secret_encrypted",
		"secret_key_hint", "webhook_secret_hint",
		"created_at", "updated_at",
	}
}

func newPaymentAdminServer(t *testing.T, logs *bytes.Buffer) (*httptest.Server, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	logger := slog.Default()
	if logs != nil {
		logger = slog.New(slog.NewTextHandler(logs, nil))
	}
	ts := httptest.NewServer(NewHandler(db, dbmodels.New(db), &testStorageProvider{}, logger, newAdminTestEncryptor(t), nil, testutil.TokenManager()))
	t.Cleanup(ts.Close)
	return ts, mock
}

func addPaymentConfigRow(
	rows *sqlmock.Rows,
	tenantID uuid.UUID,
	enabled bool,
	secretEnc, webhookEnc, secretHint, webhookHint string,
	now time.Time,
) *sqlmock.Rows {
	return rows.AddRow(
		tenantID,
		paymentsettings.ProviderStripe,
		enabled,
		sql.NullString{String: secretEnc, Valid: secretEnc != ""},
		sql.NullString{String: webhookEnc, Valid: webhookEnc != ""},
		sql.NullString{String: secretHint, Valid: secretHint != ""},
		sql.NullString{String: webhookHint, Valid: webhookHint != ""},
		now,
		now,
	)
}

func TestGetTenantPaymentSettingsRejectsEditorRole(t *testing.T) {
	ts, mock := newPaymentAdminServer(t, nil)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)

	client := publiraadminv1connect.NewAdminPaymentSettingsServiceClient(ts.Client(), ts.URL)
	req := connect.NewRequest(&publiraadminv1.GetTenantPaymentSettingsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)
	_, err := client.GetTenantPaymentSettings(context.Background(), req)
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("GetTenantPaymentSettings code = %v, want permission_denied", connect.CodeOf(err))
	}
	assertExpectations(t, mock)
}

func TestGetTenantPaymentSettingsReturnsEmptyWhenMissing(t *testing.T) {
	ts, mock := newPaymentAdminServer(t, nil)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")
	mock.ExpectQuery(regexp.QuoteMeta(getTenantPaymentConfigByTenantIDQuery)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)

	client := publiraadminv1connect.NewAdminPaymentSettingsServiceClient(ts.Client(), ts.URL)
	req := connect.NewRequest(&publiraadminv1.GetTenantPaymentSettingsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)
	resp, err := client.GetTenantPaymentSettings(context.Background(), req)
	if err != nil {
		t.Fatalf("GetTenantPaymentSettings: %v", err)
	}
	settings := resp.Msg.Settings
	if settings.Provider != paymentsettings.ProviderStripe || settings.Enabled || settings.Ready || settings.SecretKeyConfigured {
		t.Fatalf("settings = %+v, want empty disabled stripe", settings)
	}
	if settings.SecretKeyHint != "" || settings.WebhookSecretHint != "" {
		t.Fatalf("hints = (%q, %q), want empty", settings.SecretKeyHint, settings.WebhookSecretHint)
	}
	assertExpectations(t, mock)
}

func TestGetTenantPaymentSettingsOmitsPlaintextSecrets(t *testing.T) {
	var logs bytes.Buffer
	ts, mock := newPaymentAdminServer(t, &logs)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	secretHint := paymentsettings.MaskSecret(testPaymentSecretKey)
	webhookHint := paymentsettings.MaskSecret(testPaymentWebhookSecret)
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")
	mock.ExpectQuery(regexp.QuoteMeta(getTenantPaymentConfigByTenantIDQuery)).
		WithArgs(tenantID).
		WillReturnRows(addPaymentConfigRow(
			sqlmock.NewRows(tenantPaymentColumns()),
			tenantID,
			true,
			"enc:v1:k1:ciphertext",
			"enc:v1:k1:webhook",
			secretHint,
			webhookHint,
			now,
		))

	client := publiraadminv1connect.NewAdminPaymentSettingsServiceClient(ts.Client(), ts.URL)
	req := connect.NewRequest(&publiraadminv1.GetTenantPaymentSettingsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)
	resp, err := client.GetTenantPaymentSettings(context.Background(), req)
	if err != nil {
		t.Fatalf("GetTenantPaymentSettings: %v", err)
	}
	settings := resp.Msg.Settings
	if !settings.Enabled || !settings.Ready || !settings.SecretKeyConfigured || !settings.WebhookSecretConfigured {
		t.Fatalf("settings = %+v, want ready enabled config", settings)
	}
	if settings.SecretKeyHint != secretHint || settings.WebhookSecretHint != webhookHint {
		t.Fatalf("hints = (%q, %q)", settings.SecretKeyHint, settings.WebhookSecretHint)
	}
	dump := settings.String() + logs.String()
	if strings.Contains(dump, testPaymentSecretKey) || strings.Contains(dump, testPaymentWebhookSecret) {
		t.Fatalf("response or logs leaked a secret: %s", dump)
	}
	assertExpectations(t, mock)
}

func TestUpdateTenantPaymentSettingsRejectsEditorRole(t *testing.T) {
	ts, mock := newPaymentAdminServer(t, nil)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)

	client := publiraadminv1connect.NewAdminPaymentSettingsServiceClient(ts.Client(), ts.URL)
	req := connect.NewRequest(&publiraadminv1.UpdateTenantPaymentSettingsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)
	_, err := client.UpdateTenantPaymentSettings(context.Background(), req)
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("UpdateTenantPaymentSettings code = %v, want permission_denied", connect.CodeOf(err))
	}
	assertExpectations(t, mock)
}

func TestUpdateTenantPaymentSettingsRejectsEnableWithoutSecrets(t *testing.T) {
	ts, mock := newPaymentAdminServer(t, nil)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")
	mock.ExpectQuery(regexp.QuoteMeta(getTenantPaymentConfigByTenantIDQuery)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)

	client := publiraadminv1connect.NewAdminPaymentSettingsServiceClient(ts.Client(), ts.URL)
	req := connect.NewRequest(&publiraadminv1.UpdateTenantPaymentSettingsRequest{
		Enabled: true,
		Tenant:  &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)
	_, err := client.UpdateTenantPaymentSettings(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("UpdateTenantPaymentSettings code = %v, want invalid_argument", connect.CodeOf(err))
	}
	if err == nil || !strings.Contains(err.Error(), "required") {
		t.Fatalf("error = %v, want secrets-required message", err)
	}
	if strings.Contains(err.Error(), testPaymentSecretKey) {
		t.Fatalf("error leaked a secret: %v", err)
	}
	assertExpectations(t, mock)
}

func TestUpdateTenantPaymentSettingsRejectsUnknownProvider(t *testing.T) {
	ts, mock := newPaymentAdminServer(t, nil)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")

	client := publiraadminv1connect.NewAdminPaymentSettingsServiceClient(ts.Client(), ts.URL)
	req := connect.NewRequest(&publiraadminv1.UpdateTenantPaymentSettingsRequest{
		Provider: "paypal",
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)
	_, err := client.UpdateTenantPaymentSettings(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("UpdateTenantPaymentSettings code = %v, want invalid_argument", connect.CodeOf(err))
	}
	assertExpectations(t, mock)
}

func TestUpdateTenantPaymentSettingsEncryptsAndReturnsPublicView(t *testing.T) {
	var logs bytes.Buffer
	ts, mock := newPaymentAdminServer(t, &logs)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	secretHint := paymentsettings.MaskSecret(testPaymentSecretKey)
	webhookHint := paymentsettings.MaskSecret(testPaymentWebhookSecret)
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")
	mock.ExpectQuery(regexp.QuoteMeta(getTenantPaymentConfigByTenantIDQuery)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta(upsertTenantPaymentConfigQuery)).
		WithArgs(
			tenantID,
			paymentsettings.ProviderStripe,
			true,
			sqlmock.AnyArg(),
			sqlmock.AnyArg(),
			sql.NullString{String: secretHint, Valid: true},
			sql.NullString{String: webhookHint, Valid: true},
		).
		WillReturnRows(addPaymentConfigRow(
			sqlmock.NewRows(tenantPaymentColumns()),
			tenantID,
			true,
			"enc:v1:k1:ciphertext",
			"enc:v1:k1:webhook",
			secretHint,
			webhookHint,
			now,
		))
	expectAdminAuditLogInsert(mock)

	client := publiraadminv1connect.NewAdminPaymentSettingsServiceClient(ts.Client(), ts.URL)
	req := connect.NewRequest(&publiraadminv1.UpdateTenantPaymentSettingsRequest{
		Enabled:                 true,
		SecretKey:               testPaymentSecretKey,
		SecretKeyUpdateMode:     publiraadminv1.SecretUpdateMode_SECRET_UPDATE_MODE_REPLACE,
		WebhookSecret:           testPaymentWebhookSecret,
		WebhookSecretUpdateMode: publiraadminv1.SecretUpdateMode_SECRET_UPDATE_MODE_REPLACE,
		Tenant:                  &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)
	resp, err := client.UpdateTenantPaymentSettings(context.Background(), req)
	if err != nil {
		t.Fatalf("UpdateTenantPaymentSettings: %v", err)
	}
	settings := resp.Msg.Settings
	if !settings.Ready || settings.SecretKeyHint != secretHint {
		t.Fatalf("settings = %+v", settings)
	}
	dump := settings.String() + logs.String() + errString(err)
	if strings.Contains(dump, testPaymentSecretKey) || strings.Contains(dump, testPaymentWebhookSecret) {
		t.Fatalf("response or logs leaked a secret: %s", dump)
	}
	assertExpectations(t, mock)
}

func errString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
