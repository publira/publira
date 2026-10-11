package adminapi

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/http/httptest"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/paymentprovider/payjp"
	"github.com/publira/publira/server/internal/paymentprovider/stripe"
	"github.com/publira/publira/server/internal/paymentsettings"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
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
		"created_at", "updated_at",
		"credentials_encrypted", "credential_hints",
		"currency",
	}
}

// expectPlatformDefaultCurrency answers the platform's default currency, which
// a tenant with no payment settings sells in.
func expectPlatformDefaultCurrency(mock sqlmock.Sqlmock, currency string) {
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetPlatformDefaultCurrency)).
		WillReturnRows(sqlmock.NewRows([]string{"default_currency"}).AddRow(currency))
}

// expectTenantHasPurchases answers whether the tenant has a purchase, which
// locks its currency.
func expectTenantHasPurchases(mock sqlmock.Sqlmock, tenantID uuid.UUID, has bool) {
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.TenantHasPurchases)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(has))
}

// expectTenantCurrencyLock is the lock a save of the payment settings holds
// the tenant currency under before it reads it.
func expectTenantCurrencyLock(mock sqlmock.Sqlmock, tenantID uuid.UUID) {
	mock.ExpectExec(regexp.QuoteMeta(dbmodels.LockTenantCurrency)).
		WithArgs(tenantID).
		WillReturnResult(sqlmock.NewResult(0, 0))
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
		"JPY",
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

	client := publiraadminv1connect.NewAdminPaymentSettingsServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	req := &publiraadminv1.ListPaymentProvidersRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}
	resp, err := client.ListPaymentProviders(testutil.WithBearer(context.Background(), sessionToken), req)
	if err != nil {
		t.Fatalf("ListPaymentProviders: %v", err)
	}
	var found *publiraadminv1.PaymentProvider
	for _, provider := range resp.Providers {
		if provider.Id == stripe.ID {
			found = provider
		}
	}
	if found == nil {
		t.Fatalf("providers = %+v, want stripe among them", resp.Providers)
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
	if !slices.Contains(found.Currencies, "JPY") || !slices.Contains(found.Currencies, "USD") {
		t.Fatalf("stripe currencies = %v, want JPY and USD among them", found.Currencies)
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

	client := publiraadminv1connect.NewAdminPaymentSettingsServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	req := &publiraadminv1.ListPaymentProvidersRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}
	if _, err := client.ListPaymentProviders(testutil.WithBearer(context.Background(), sessionToken), req); connect.CodeOf(err) != connect.CodePermissionDenied {
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

	client := publiraadminv1connect.NewAdminPaymentSettingsServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	req := &publiraadminv1.GetTenantPaymentSettingsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}
	_, err := client.GetTenantPaymentSettings(testutil.WithBearer(context.Background(), sessionToken), req)
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
	expectTenantHasPurchases(mock, tenantID, false)
	expectPlatformDefaultCurrency(mock, "JPY")

	client := publiraadminv1connect.NewAdminPaymentSettingsServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	req := &publiraadminv1.GetTenantPaymentSettingsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}
	resp, err := client.GetTenantPaymentSettings(testutil.WithBearer(context.Background(), sessionToken), req)
	if err != nil {
		t.Fatalf("GetTenantPaymentSettings: %v", err)
	}
	settings := resp.Settings
	if settings.Provider != "" || settings.Enabled || settings.Ready || len(settings.Fields) != 0 {
		t.Fatalf("settings = %+v, want empty with no provider", settings)
	}
	if settings.Currency != "JPY" || settings.CurrencyLocked {
		t.Fatalf("currency = %q locked %v, want an unlocked JPY", settings.Currency, settings.CurrencyLocked)
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
	expectTenantHasPurchases(mock, tenantID, true)

	client := publiraadminv1connect.NewAdminPaymentSettingsServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	req := &publiraadminv1.GetTenantPaymentSettingsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}
	resp, err := client.GetTenantPaymentSettings(testutil.WithBearer(context.Background(), sessionToken), req)
	if err != nil {
		t.Fatalf("GetTenantPaymentSettings: %v", err)
	}
	settings := resp.Settings
	if settings.Provider != stripe.ID || !settings.Enabled || !settings.Ready {
		t.Fatalf("settings = %+v, want ready enabled stripe", settings)
	}
	if settings.Currency != "JPY" || !settings.CurrencyLocked {
		t.Fatalf("currency = %q locked %v, want JPY locked by the tenant's purchase", settings.Currency, settings.CurrencyLocked)
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

	client := publiraadminv1connect.NewAdminPaymentSettingsServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	req := &publiraadminv1.UpdateTenantPaymentSettingsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}
	_, err := client.UpdateTenantPaymentSettings(testutil.WithBearer(context.Background(), sessionToken), req)
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
	expectTenantCurrencyLock(mock, tenantID)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantPaymentConfigByTenantID)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)
	expectPlatformDefaultCurrency(mock, "JPY")
	expectTenantHasPurchases(mock, tenantID, false)
	mock.ExpectRollback()

	client := publiraadminv1connect.NewAdminPaymentSettingsServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	req := &publiraadminv1.UpdateTenantPaymentSettingsRequest{
		Provider: stripe.ID,
		Enabled:  true,
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}
	_, err := client.UpdateTenantPaymentSettings(testutil.WithBearer(context.Background(), sessionToken), req)
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

	client := publiraadminv1connect.NewAdminPaymentSettingsServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	req := &publiraadminv1.UpdateTenantPaymentSettingsRequest{
		Provider: "paypal",
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}
	_, err := client.UpdateTenantPaymentSettings(testutil.WithBearer(context.Background(), sessionToken), req)
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
	expectTenantCurrencyLock(mock, tenantID)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantPaymentConfigByTenantID)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)
	expectPlatformDefaultCurrency(mock, "JPY")
	expectTenantHasPurchases(mock, tenantID, false)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.UpsertTenantPaymentConfig)).
		WithArgs(
			tenantID,
			stripe.ID,
			true,
			sqlmock.AnyArg(),
			stripeFieldsJSON(t, secretHint, webhookHint),
			"JPY",
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

	client := publiraadminv1connect.NewAdminPaymentSettingsServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	req := &publiraadminv1.UpdateTenantPaymentSettingsRequest{
		Provider: stripe.ID,
		Enabled:  true,
		Fields: []*publiraadminv1.PaymentCredentialFieldUpdate{
			{Name: stripe.FieldSecretKey, Mode: publiraadminv1.SecretUpdateMode_SECRET_UPDATE_MODE_REPLACE, Value: testPaymentSecretKey},
			{Name: stripe.FieldWebhookSecret, Mode: publiraadminv1.SecretUpdateMode_SECRET_UPDATE_MODE_REPLACE, Value: testPaymentWebhookSecret},
		},
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}
	resp, err := client.UpdateTenantPaymentSettings(testutil.WithBearer(context.Background(), sessionToken), req)
	if err != nil {
		t.Fatalf("UpdateTenantPaymentSettings: %v", err)
	}
	settings := resp.Settings
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

func TestUpdateTenantPaymentSettingsRefusesACurrencyChangeOnceTheTenantHasAPurchase(t *testing.T) {
	ts, mock := newPaymentAdminServer(t, nil)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")
	mock.ExpectBegin()
	expectTenantCurrencyLock(mock, tenantID)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantPaymentConfigByTenantID)).
		WithArgs(tenantID).
		WillReturnRows(addPaymentConfigRow(t, sqlmock.NewRows(tenantPaymentColumns()), tenantID, true,
			"enc:v1:k1:ciphertext", "enc:v1:k1:webhook", "sk_••••", "whsec_••••", now))
	expectTenantHasPurchases(mock, tenantID, true)
	mock.ExpectRollback()

	client := publiraadminv1connect.NewAdminPaymentSettingsServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	_, err := client.UpdateTenantPaymentSettings(testutil.WithBearer(context.Background(), sessionToken), &publiraadminv1.UpdateTenantPaymentSettingsRequest{
		Provider: stripe.ID,
		Enabled:  true,
		Currency: "USD",
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("UpdateTenantPaymentSettings code = %v, want failed_precondition", connect.CodeOf(err))
	}
	assertExpectations(t, mock)
}

func TestUpdateTenantPaymentSettingsRefusesACurrencyTheProviderDoesNotDeclare(t *testing.T) {
	ts, mock := newPaymentAdminServer(t, nil)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")
	mock.ExpectBegin()
	expectTenantCurrencyLock(mock, tenantID)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantPaymentConfigByTenantID)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)
	expectPlatformDefaultCurrency(mock, "JPY")
	expectTenantHasPurchases(mock, tenantID, false)
	mock.ExpectRollback()

	client := publiraadminv1connect.NewAdminPaymentSettingsServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	_, err := client.UpdateTenantPaymentSettings(testutil.WithBearer(context.Background(), sessionToken), &publiraadminv1.UpdateTenantPaymentSettingsRequest{
		Provider: payjp.ID,
		Currency: "USD",
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("UpdateTenantPaymentSettings code = %v, want invalid_argument", connect.CodeOf(err))
	}
	assertExpectations(t, mock)
}
