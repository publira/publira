package adminapi

import (
	"context"
	"database/sql"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/testutil"
)

func expectAdminTenantByDomains(mock sqlmock.Sqlmock, tenantID uuid.UUID, now time.Time, defaultLocale string) {
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetAdminTenantByDomains)).
		WillReturnRows(sqlmock.NewRows(tenantColumns()).
			AddRow(tenantID, "TENANT001", "tenant.example.com", "Tenant", now, "active", "admin.tenant.example.com", "UTC", defaultLocale, testSupportedLocalesRow, nil))
}

// Host resolution is the only tenant read the console makes without a session,
// so it is the one that can tell the browser which language the tenant saved.
func TestAdminGetTenantByDomainReturnsDefaultLocale(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	tenantID := uuid.Must(uuid.NewV7())
	expectAdminTenantByDomains(mock, tenantID, time.Now(), "en")

	client := publiraadminv1connect.NewAdminAuthServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	resp, err := client.GetTenantByDomain(context.Background(), &publiraadminv1.AdminAuthServiceGetTenantByDomainRequest{
		Domains: []string{"admin.tenant.example.com"},
	})
	if err != nil {
		t.Fatalf("GetTenantByDomain: %v", err)
	}
	if resp.TenantId != tenantID.String() {
		t.Fatalf("tenant_id = %q, want %s", resp.TenantId, tenantID)
	}
	if resp.DefaultLocale != "en" {
		t.Fatalf("default_locale = %q, want en", resp.DefaultLocale)
	}
	assertExpectations(t, mock)
}

// A stored code this build serves no catalog for ends the request. Answering
// the tenant id alone would leave the console publishing nothing and the
// document naming no language, which hides the data fault behind a screen that
// looks like it worked.
func TestAdminGetTenantByDomainFailsOnAnUnusableStoredLocale(t *testing.T) {
	tests := []struct {
		name   string
		stored string
	}{
		{name: "blank", stored: ""},
		{name: "unsupported code", stored: "fr"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ts, mock := newTestAdminServer(t)
			expectAdminTenantByDomains(mock, uuid.Must(uuid.NewV7()), time.Now(), tt.stored)

			client := publiraadminv1connect.NewAdminAuthServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
			_, err := client.GetTenantByDomain(context.Background(), &publiraadminv1.AdminAuthServiceGetTenantByDomainRequest{
				Domains: []string{"admin.tenant.example.com"},
			})
			if connect.CodeOf(err) != connect.CodeInternal {
				t.Fatalf("GetTenantByDomain code = %v, want internal (err=%v)", connect.CodeOf(err), err)
			}
			assertExpectations(t, mock)
		})
	}
}

// The password reset form answers a registered address exactly as it answers an
// unknown one, so it records the request the worker resolves and never asks
// whether the address has an account: sqlmock refuses any lookup it was not
// told to expect, and a lookup is what would let the time the form takes tell
// the two apart.
func TestAdminRequestPasswordResetRecordsTheRequestWithoutLookingUpTheAddress(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	tenantID := uuid.Must(uuid.NewV7())
	expectTenantLookup(mock, tenantID, "TENANT001", time.Now())
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.InsertOutboxEvent)).
		WithArgs(
			sqlmock.AnyArg(),
			uuid.NullUUID{UUID: tenantID, Valid: true},
			outbox.EventTypeAdminPasswordResetRequest,
			sqlmock.AnyArg(),
			sqlmock.AnyArg(),
			sqlmock.AnyArg(),
		).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "tenant_id", "event_type", "payload", "idempotency_key",
			"status", "attempts", "available_at", "last_error", "created_at", "updated_at", "progress_cursor",
		}).AddRow(
			uuid.Must(uuid.NewV7()), uuid.NullUUID{UUID: tenantID, Valid: true}, outbox.EventTypeAdminPasswordResetRequest, []byte("{}"),
			"key", outbox.StatusPending, int32(0), time.Now(), nil, time.Now(), time.Now(), nil,
		))

	client := publiraadminv1connect.NewAdminAuthServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	resp, err := client.RequestPasswordReset(context.Background(), &publiraadminv1.AdminAuthServiceRequestPasswordResetRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Email:  "admin@tenant.example",
	})
	if err != nil {
		t.Fatalf("RequestPasswordReset: %v", err)
	}
	if !resp.Requested {
		t.Fatal("requested = false, want true")
	}
	assertExpectations(t, mock)
}

func newUpdateTenantConfigRequest(tenantID uuid.UUID) *publiraadminv1.AdminAuthServiceUpdateTenantConfigRequest {
	req := &publiraadminv1.AdminAuthServiceUpdateTenantConfigRequest{
		Tenant:          &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		CopyrightText:   "© Tenant",
		SiteDescription: "A tenant that exists only in a test",
		SiteTagline:     "Read on",
	}
	return req
}

func tenantConfigTranslationColumns() []string {
	return []string{"id", "tenant_id", "locale", "site_tagline", "site_description", "copyright_text", "created_at", "updated_at"}
}

// tenantSiteCopyRow is the copy newUpdateTenantConfigRequest writes, stored in
// locale.
func tenantSiteCopyRow(tenantID uuid.UUID, locale string, now time.Time) *sqlmock.Rows {
	return sqlmock.NewRows(tenantConfigTranslationColumns()).
		AddRow(uuid.Must(uuid.NewV7()), tenantID, locale, "Read on", "A tenant that exists only in a test", "© Tenant", now, now)
}

func expectSiteCopyLockedAs(mock sqlmock.Sqlmock, tenantID uuid.UUID, locale string, rows *sqlmock.Rows) {
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.LockTenantConfigTranslation)).
		WithArgs(tenantID, locale).
		WillReturnRows(rows)
}

func expectSiteCopyUpsert(mock sqlmock.Sqlmock, tenantID uuid.UUID, locale string, now time.Time) {
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.UpsertTenantConfigTranslation)).
		WithArgs(sqlmock.AnyArg(), tenantID, locale, "Read on", "A tenant that exists only in a test", "© Tenant").
		WillReturnRows(tenantSiteCopyRow(tenantID, locale, now))
}

// The public site reads the site copy through the cached tenant site entry, so
// the save records that entry's drop in its own transaction. A request naming
// no locale writes the tenant's default locale's copy.
func TestUpdateTenantConfigRecordsItsInvalidationBeforeCommitting(t *testing.T) {
	revalidations := newRevalidateRecorder(t)
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "tenant_admin")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")

	mock.ExpectBegin()
	expectSiteCopyLockedAs(mock, tenantID, "ja", sqlmock.NewRows(tenantConfigTranslationColumns()))
	expectSiteCopyUpsert(mock, tenantID, "ja", now)
	expectAdminAuditLogInsert(mock)
	expectRevalidationRecord(mock, tenantID)
	mock.ExpectCommit()

	client := publiraadminv1connect.NewAdminAuthServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	resp, err := client.UpdateTenantConfig(testutil.WithBearer(context.Background(), sessionToken), newUpdateTenantConfigRequest(tenantID))
	if err != nil {
		t.Fatalf("UpdateTenantConfig: %v", err)
	}
	if resp.CopyrightText != "© Tenant" || resp.SiteTagline != "Read on" || resp.Locale != "ja" {
		t.Fatalf("tenant config = %+v, want the values just written in ja", resp)
	}
	revalidations.waitForTags(t, []string{"tenant:" + tenantID.String() + ":site"})
	assertExpectations(t, mock)
}

// Clearing every field leaves the locale with no copy, so its row goes and its
// readers are served the copy the others fall back to.
func TestUpdateTenantConfigDeletesTheCopyOfALocaleItClears(t *testing.T) {
	revalidations := newRevalidateRecorder(t)
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "tenant_admin")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")

	mock.ExpectBegin()
	expectSiteCopyLockedAs(mock, tenantID, "en", tenantSiteCopyRow(tenantID, "en", now))
	mock.ExpectExec(regexp.QuoteMeta(dbmodels.DeleteTenantConfigTranslation)).
		WithArgs(tenantID, "en").
		WillReturnResult(sqlmock.NewResult(0, 1))
	expectAdminAuditLogInsert(mock)
	expectRevalidationRecord(mock, tenantID)
	mock.ExpectCommit()

	client := publiraadminv1connect.NewAdminAuthServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	resp, err := client.UpdateTenantConfig(testutil.WithBearer(context.Background(), sessionToken), &publiraadminv1.AdminAuthServiceUpdateTenantConfigRequest{
		Tenant:      &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Locale:      "en",
		SiteTagline: "  ",
	})
	if err != nil {
		t.Fatalf("UpdateTenantConfig: %v", err)
	}
	if resp.CopyrightText != "" || resp.SiteDescription != "" || resp.SiteTagline != "" || resp.Locale != "en" {
		t.Fatalf("tenant config = %+v, want no copy in en", resp)
	}
	revalidations.waitForTags(t, []string{"tenant:" + tenantID.String() + ":site"})
	assertExpectations(t, mock)
}

// A save of what the locale already holds writes nothing, so it records no
// audit entry and drops no cache.
func TestUpdateTenantConfigWritesNothingWhenTheCopyIsUnchanged(t *testing.T) {
	newRevalidateRecorder(t)
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "tenant_admin")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")

	mock.ExpectBegin()
	expectSiteCopyLockedAs(mock, tenantID, "ja", tenantSiteCopyRow(tenantID, "ja", now))
	mock.ExpectCommit()

	client := publiraadminv1connect.NewAdminAuthServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	resp, err := client.UpdateTenantConfig(testutil.WithBearer(context.Background(), sessionToken), newUpdateTenantConfigRequest(tenantID))
	if err != nil {
		t.Fatalf("UpdateTenantConfig: %v", err)
	}
	if resp.CopyrightText != "© Tenant" || resp.Locale != "ja" {
		t.Fatalf("tenant config = %+v, want the copy the locale holds", resp)
	}
	assertExpectations(t, mock)
}

// Copy in a language the site does not serve would never be shown, so both
// the read and the write refuse it before touching the database.
func TestTenantConfigRefusesALocaleTheTenantDoesNotOffer(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "tenant_admin")
	client := publiraadminv1connect.NewAdminAuthServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	expectOnlyJapanese := func() {
		mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantByID)).
			WithArgs(tenantID).
			WillReturnRows(sqlmock.NewRows(tenantColumns()).
				AddRow(tenantID, "TENANT001", "tenant.example", "Tenant", now, "active", nil, "UTC", "ja", "{ja}", nil))
		expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")
	}

	expectOnlyJapanese()
	_, err := client.GetTenantConfig(testutil.WithBearer(context.Background(), sessionToken), &publiraadminv1.AdminAuthServiceGetTenantConfigRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Locale: "en",
	})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("GetTenantConfig code = %v, want invalid_argument", connect.CodeOf(err))
	}

	expectOnlyJapanese()
	req := newUpdateTenantConfigRequest(tenantID)
	req.Locale = "en"
	_, err = client.UpdateTenantConfig(testutil.WithBearer(context.Background(), sessionToken), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("UpdateTenantConfig code = %v, want invalid_argument", connect.CodeOf(err))
	}
	assertExpectations(t, mock)
}

// The console edits one locale's copy at a time, so a locale with none reads
// as empty rather than as the copy its readers fall back to.
func TestGetTenantConfigReadsOnlyTheLocaleAsked(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "tenant_auditor")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_auditor")
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantConfigTranslation)).
		WithArgs(tenantID, "en").
		WillReturnError(sql.ErrNoRows)

	client := publiraadminv1connect.NewAdminAuthServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	resp, err := client.GetTenantConfig(testutil.WithBearer(context.Background(), sessionToken), &publiraadminv1.AdminAuthServiceGetTenantConfigRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Locale: "en",
	})
	if err != nil {
		t.Fatalf("GetTenantConfig: %v", err)
	}
	if resp.CopyrightText != "" || resp.SiteDescription != "" || resp.SiteTagline != "" || resp.Locale != "en" {
		t.Fatalf("tenant config = %+v, want no copy in en", resp)
	}
	assertExpectations(t, mock)
}

// A save whose cache drop cannot be recorded is rolled back rather than
// committed with nothing owing the drop.
func TestUpdateTenantConfigRollsBackWhenItsInvalidationCannotBeRecorded(t *testing.T) {
	newRevalidateRecorder(t)
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "tenant_admin")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")

	mock.ExpectBegin()
	expectSiteCopyLockedAs(mock, tenantID, "ja", sqlmock.NewRows(tenantConfigTranslationColumns()))
	expectSiteCopyUpsert(mock, tenantID, "ja", now)
	expectAdminAuditLogInsert(mock)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.InsertOutboxEvent)).
		WillReturnError(sql.ErrConnDone)
	mock.ExpectRollback()

	client := publiraadminv1connect.NewAdminAuthServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	_, err := client.UpdateTenantConfig(testutil.WithBearer(context.Background(), sessionToken), newUpdateTenantConfigRequest(tenantID))
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("UpdateTenantConfig code = %v, want internal", connect.CodeOf(err))
	}
	assertExpectations(t, mock)
}
