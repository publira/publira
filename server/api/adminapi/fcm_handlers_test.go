package adminapi

import (
	"bytes"
	"context"
	"database/sql"
	"database/sql/driver"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"regexp"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/testutil"
)

func tenantFcmColumns() []string {
	return []string{"tenant_id", "project_id", "client_email", "service_account_json_encrypted", "created_at", "updated_at"}
}

func newFcmClient(t *testing.T, logs *bytes.Buffer) (publiraadminv1connect.AdminFcmSettingsServiceClient, sqlmock.Sqlmock) {
	t.Helper()
	ts, mock := newPaymentAdminServer(t, logs)
	return publiraadminv1connect.NewAdminFcmSettingsServiceClient(ts.Client(), ts.URL), mock
}

func TestGetTenantFcmSettingsDescribesTheKeyWithoutReturningIt(t *testing.T) {
	var logs bytes.Buffer
	client, mock := newFcmClient(t, &logs)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantFcmConfig)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows(tenantFcmColumns()).
			AddRow(tenantID, "tenant-a", "push@tenant-a.iam.gserviceaccount.com", "enc:v1:k1:sealed-key", now, now))

	resp, err := client.GetTenantFcmSettings(context.Background(), withBearer(&publiraadminv1.GetTenantFcmSettingsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}, sessionToken))
	if err != nil {
		t.Fatalf("GetTenantFcmSettings: %v", err)
	}
	settings := resp.Msg.Settings
	if !settings.Configured || settings.ProjectId != "tenant-a" || settings.ClientEmail != "push@tenant-a.iam.gserviceaccount.com" || settings.UpdatedAt == "" {
		t.Fatalf("settings = %+v", settings)
	}
	if strings.Contains(settings.String()+logs.String(), "sealed-key") {
		t.Fatal("the response or the logs carry the stored key")
	}
	assertExpectations(t, mock)
}

func TestGetTenantFcmSettingsIsUnconfiguredWithoutARow(t *testing.T) {
	client, mock := newFcmClient(t, nil)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantFcmConfig)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)

	resp, err := client.GetTenantFcmSettings(context.Background(), withBearer(&publiraadminv1.GetTenantFcmSettingsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}, sessionToken))
	if err != nil {
		t.Fatalf("GetTenantFcmSettings: %v", err)
	}
	if settings := resp.Msg.Settings; settings.Configured || settings.ProjectId != "" || settings.ClientEmail != "" || settings.UpdatedAt != "" {
		t.Fatalf("settings = %+v, want unconfigured", settings)
	}
	assertExpectations(t, mock)
}

// Credentials are a tenant administrator's to change; an editor is refused
// before anything is read or written.
func TestFcmCredentialChangesRejectEditorRole(t *testing.T) {
	keyJSON := testutil.ServiceAccountJSON(t, "tenant-a", "push@tenant-a.iam.gserviceaccount.com")
	for name, call := range map[string]func(publiraadminv1connect.AdminFcmSettingsServiceClient, *publirattypesv1.TenantContext, string) error{
		"save": func(client publiraadminv1connect.AdminFcmSettingsServiceClient, tenant *publirattypesv1.TenantContext, token string) error {
			_, err := client.SaveTenantFcmCredentials(context.Background(), withBearer(&publiraadminv1.SaveTenantFcmCredentialsRequest{
				Tenant: tenant, ProjectId: "tenant-a", ServiceAccountJson: keyJSON,
			}, token))
			return err
		},
		"delete": func(client publiraadminv1connect.AdminFcmSettingsServiceClient, tenant *publirattypesv1.TenantContext, token string) error {
			_, err := client.DeleteTenantFcmCredentials(context.Background(), withBearer(&publiraadminv1.DeleteTenantFcmCredentialsRequest{Tenant: tenant}, token))
			return err
		},
	} {
		t.Run(name, func(t *testing.T) {
			client, mock := newFcmClient(t, nil)
			now := time.Now()
			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
			expectTenantLookup(mock, tenantID, "TENANT001", now)
			expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)

			err := call(client, &publirattypesv1.TenantContext{TenantId: tenantID.String()}, sessionToken)
			if connect.CodeOf(err) != connect.CodePermissionDenied {
				t.Fatalf("code = %v, want permission_denied", connect.CodeOf(err))
			}
			assertExpectations(t, mock)
		})
	}
}

// A refused key is answered with what is wrong with it and nothing from it,
// and nothing is written.
func TestSaveTenantFcmCredentialsRefusesAnInvalidKey(t *testing.T) {
	keyJSON := testutil.ServiceAccountJSON(t, "tenant-a", "push@tenant-a.iam.gserviceaccount.com")
	for name, tc := range map[string]struct {
		projectID string
		keyJSON   string
		message   string
	}{
		"another project":       {projectID: "tenant-b", keyJSON: keyJSON, message: "different project"},
		"no project":            {projectID: "", keyJSON: keyJSON, message: "project id is required"},
		"not a service account": {projectID: "tenant-a", keyJSON: `{"type":"authorized_user"}`, message: "invalid service account key"},
	} {
		t.Run(name, func(t *testing.T) {
			client, mock := newFcmClient(t, nil)
			now := time.Now()
			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
			expectTenantLookup(mock, tenantID, "TENANT001", now)
			expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")

			_, err := client.SaveTenantFcmCredentials(context.Background(), withBearer(&publiraadminv1.SaveTenantFcmCredentialsRequest{
				Tenant:             &publirattypesv1.TenantContext{TenantId: tenantID.String()},
				ProjectId:          tc.projectID,
				ServiceAccountJson: tc.keyJSON,
			}, sessionToken))
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("code = %v, want invalid_argument", connect.CodeOf(err))
			}
			if !strings.Contains(err.Error(), tc.message) || strings.Contains(err.Error(), "PRIVATE KEY") {
				t.Fatalf("error = %v, want %q and no key material", err, tc.message)
			}
			assertExpectations(t, mock)
		})
	}
}

func TestSaveTenantFcmCredentialsSealsTheKeyAndAudits(t *testing.T) {
	var logs bytes.Buffer
	client, mock := newFcmClient(t, &logs)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	keyJSON := testutil.ServiceAccountJSON(t, "tenant-a", "push@tenant-a.iam.gserviceaccount.com")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.UpsertTenantFcmConfig)).
		WithArgs(tenantID, "tenant-a", "push@tenant-a.iam.gserviceaccount.com", sealedArg{}).
		WillReturnRows(sqlmock.NewRows(tenantFcmColumns()).
			AddRow(tenantID, "tenant-a", "push@tenant-a.iam.gserviceaccount.com", "enc:v1:k1:sealed-key", now, now))
	expectAdminAuditLogInsert(mock)

	resp, err := client.SaveTenantFcmCredentials(context.Background(), withBearer(&publiraadminv1.SaveTenantFcmCredentialsRequest{
		Tenant:             &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		ProjectId:          "tenant-a",
		ServiceAccountJson: keyJSON,
	}, sessionToken))
	if err != nil {
		t.Fatalf("SaveTenantFcmCredentials: %v", err)
	}
	if settings := resp.Msg.Settings; !settings.Configured || settings.ProjectId != "tenant-a" {
		t.Fatalf("settings = %+v", settings)
	}
	if strings.Contains(resp.Msg.String()+logs.String(), "PRIVATE KEY") {
		t.Fatal("the response or the logs carry the key")
	}
	assertExpectations(t, mock)
}

func TestDeleteTenantFcmCredentialsAnswersUnconfigured(t *testing.T) {
	client, mock := newFcmClient(t, nil)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")
	mock.ExpectExec(regexp.QuoteMeta(dbmodels.DeleteTenantFcmConfig)).
		WithArgs(tenantID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	expectAdminAuditLogInsert(mock)

	resp, err := client.DeleteTenantFcmCredentials(context.Background(), withBearer(&publiraadminv1.DeleteTenantFcmCredentialsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}, sessionToken))
	if err != nil {
		t.Fatalf("DeleteTenantFcmCredentials: %v", err)
	}
	if resp.Msg.Settings.Configured {
		t.Fatalf("settings = %+v, want unconfigured", resp.Msg.Settings)
	}
	assertExpectations(t, mock)
}

// sealedArg matches a value stored as an encrypted envelope.
type sealedArg struct{}

func (sealedArg) Match(value driver.Value) bool {
	s, ok := value.(string)
	return ok && strings.HasPrefix(s, "enc:") && !strings.Contains(s, "PRIVATE KEY")
}
