package adminapi

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/paymentprovider/stripe"
	"github.com/publira/publira/server/internal/paymentsettings"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
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
		"created_at", "updated_at",
		"credentials_encrypted", "credential_hints",
	}
}

func newPaymentAdminServer(t *testing.T, logs *bytes.Buffer) (*httptest.Server, sqlmock.Sqlmock) {
	t.Helper()
	disableRevalidationUnlessRecorded(t)
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	logger := slog.Default()
	if logs != nil {
		logger = slog.New(slog.NewTextHandler(logs, nil))
	}
	handler, err := newTestHandler(db, dbmodels.New(db), &testStorageProvider{}, logger, newAdminTestEncryptor(t), nil)
	if err != nil {
		t.Fatalf("new admin handler: %v", err)
	}
	ts := httptest.NewServer(handler)
	t.Cleanup(ts.Close)
	return ts, mock
}

// stripeFieldsJSON is a Stripe row's field map holding the values given for
// the secret key and the webhook secret.
func stripeFieldsJSON(t *testing.T, secretKey, webhookSecret string) []byte {
	t.Helper()
	encoded, err := json.Marshal(map[string]string{
		stripe.FieldSecretKey:     secretKey,
		stripe.FieldWebhookSecret: webhookSecret,
	})
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	return encoded
}

func addPaymentConfigRow(
	t *testing.T,
	rows *sqlmock.Rows,
	tenantID uuid.UUID,
	enabled bool,
	secretEnc, webhookEnc, secretHint, webhookHint string,
	now time.Time,
) *sqlmock.Rows {
	t.Helper()
	return rows.AddRow(
		tenantID,
		stripe.ID,
		enabled,
		now,
		now,
		stripeFieldsJSON(t, secretEnc, webhookEnc),
		stripeFieldsJSON(t, secretHint, webhookHint),
	)
}

func stripeFieldState(t *testing.T, settings *publiraadminv1.TenantPaymentSettings, name string) *publiraadminv1.PaymentCredentialFieldState {
	t.Helper()
	for _, field := range settings.Fields {
		if field.Name == name {
			return field
		}
	}
	t.Fatalf("settings have no field %q: %+v", name, settings.Fields)
	return nil
}

func TestListPaymentProvidersAnswersEachProvidersDeclaration(t *testing.T) {
	ts, mock := newPaymentAdminServer(t, nil)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")

	client := publiraadminv1connect.NewAdminPaymentSettingsServiceClient(ts.Client(), ts.URL)
	req := connect.NewRequest(&publiraadminv1.ListPaymentProvidersRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)
	resp, err := client.ListPaymentProviders(context.Background(), req)
	if err != nil {
		t.Fatalf("ListPaymentProviders: %v", err)
	}
	var found *publiraadminv1.PaymentProvider
	for _, provider := range resp.Msg.Providers {
		if provider.Id == stripe.ID {
			found = provider
		}
	}
	if found == nil {
		t.Fatalf("providers = %+v, want stripe among them", resp.Msg.Providers)
	}
	if found.DisplayName != "Stripe" || found.WebhookPath != "/api/v1/webhook/payment/stripe" {
		t.Fatalf("stripe = %+v", found)
	}
	var names []string
	for _, field := range found.Fields {
		if !field.Secret || field.Public || !field.Required {
			t.Fatalf("stripe field %+v, want secret, not public, required", field)
		}
		names = append(names, field.Name)
	}
	if strings.Join(names, ",") != stripe.FieldSecretKey+","+stripe.FieldWebhookSecret {
		t.Fatalf("stripe fields = %v", names)
	}
	assertExpectations(t, mock)
}

func TestListPaymentProvidersRejectsEditorRole(t *testing.T) {
	ts, mock := newPaymentAdminServer(t, nil)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)

	client := publiraadminv1connect.NewAdminPaymentSettingsServiceClient(ts.Client(), ts.URL)
	req := connect.NewRequest(&publiraadminv1.ListPaymentProvidersRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)
	if _, err := client.ListPaymentProviders(context.Background(), req); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("ListPaymentProviders code = %v, want permission_denied", connect.CodeOf(err))
	}
	assertExpectations(t, mock)
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
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantPaymentConfigByTenantID)).
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
	if settings.Provider != "" || settings.Enabled || settings.Ready || len(settings.Fields) != 0 {
		t.Fatalf("settings = %+v, want empty with no provider", settings)
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
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantPaymentConfigByTenantID)).
		WithArgs(tenantID).
		WillReturnRows(addPaymentConfigRow(
			t,
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
	if settings.Provider != stripe.ID || !settings.Enabled || !settings.Ready {
		t.Fatalf("settings = %+v, want ready enabled stripe", settings)
	}
	for name, hint := range map[string]string{stripe.FieldSecretKey: secretHint, stripe.FieldWebhookSecret: webhookHint} {
		field := stripeFieldState(t, settings, name)
		if !field.Configured || field.Hint != hint || field.PublicValue != "" {
			t.Fatalf("field %s = %+v, want configured with hint %q", name, field, hint)
		}
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
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantPaymentConfigByTenantID)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()

	client := publiraadminv1connect.NewAdminPaymentSettingsServiceClient(ts.Client(), ts.URL)
	req := connect.NewRequest(&publiraadminv1.UpdateTenantPaymentSettingsRequest{
		Provider: stripe.ID,
		Enabled:  true,
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
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
	mock.ExpectBegin()
	mock.ExpectRollback()

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
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantPaymentConfigByTenantID)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.UpsertTenantPaymentConfig)).
		WithArgs(
			tenantID,
			stripe.ID,
			true,
			sqlmock.AnyArg(),
			stripeFieldsJSON(t, secretHint, webhookHint),
		).
		WillReturnRows(addPaymentConfigRow(
			t,
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
	mock.ExpectCommit()

	client := publiraadminv1connect.NewAdminPaymentSettingsServiceClient(ts.Client(), ts.URL)
	req := connect.NewRequest(&publiraadminv1.UpdateTenantPaymentSettingsRequest{
		Provider: stripe.ID,
		Enabled:  true,
		Fields: []*publiraadminv1.PaymentCredentialFieldUpdate{
			{Name: stripe.FieldSecretKey, Mode: publiraadminv1.SecretUpdateMode_SECRET_UPDATE_MODE_REPLACE, Value: testPaymentSecretKey},
			{Name: stripe.FieldWebhookSecret, Mode: publiraadminv1.SecretUpdateMode_SECRET_UPDATE_MODE_REPLACE, Value: testPaymentWebhookSecret},
		},
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)
	resp, err := client.UpdateTenantPaymentSettings(context.Background(), req)
	if err != nil {
		t.Fatalf("UpdateTenantPaymentSettings: %v", err)
	}
	settings := resp.Msg.Settings
	if !settings.Ready || stripeFieldState(t, settings, stripe.FieldSecretKey).Hint != secretHint {
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
