package adminapi

import (
	"context"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/testutil"
)

func TestBrandMarkRevalidateTags(t *testing.T) {
	tenantID := uuid.MustParse("01959a3c-0000-7000-8000-000000000001")
	got := brandMarkRevalidateTags(tenantID)
	if len(got) != 1 || got[0] != "tenant:01959a3c-0000-7000-8000-000000000001:site" {
		t.Fatalf("tags = %v, want the tenant's site tag alone", got)
	}
}

func TestValidateBrandMarkTermsURL(t *testing.T) {
	accepted := map[string]string{
		"https://example.com/guidelines":     "https://example.com/guidelines",
		"  https://example.com/guidelines  ": "https://example.com/guidelines",
	}
	for raw, want := range accepted {
		got, err := validateBrandMarkTermsURL(raw)
		if err != nil || got != want {
			t.Fatalf("validateBrandMarkTermsURL(%q) = %q, %v, want %q", raw, got, err, want)
		}
	}
	for _, raw := range []string{
		"",
		"http://example.com/guidelines",
		"javascript:alert(1)",
		"/guidelines",
		"https:///guidelines",
		"https://user:secret@example.com/guidelines",
		"https://example.com/" + string(make([]byte, maxBrandMarkTermsURLLength)),
	} {
		if _, err := validateBrandMarkTermsURL(raw); err == nil {
			t.Fatalf("validateBrandMarkTermsURL(%q) accepted it", raw)
		}
	}
}

// An upload whose terms were not accepted is refused before anything is
// stored: the session and the tenant are the only reads it makes.
func TestUploadTenantBrandMarkRefusesWithoutTheTermsAccepted(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "tenant_admin")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")

	client := publiraadminv1connect.NewTenantBrandMarkServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	_, err := client.UploadTenantBrandMark(testutil.WithBearer(context.Background(), sessionToken), &publiraadminv1.UploadTenantBrandMarkRequest{
		Tenant:           &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Kind:             publirattypesv1.TenantBrandMarkKind_TENANT_BRAND_MARK_KIND_X_SHARE,
		ImageData:        testSquarePNG(t, 64),
		ImageContentType: "image/png",
		TermsUrl:         "https://example.com/guidelines",
	})
	if connect.CodeOf(err) != connect.CodeFailedPrecondition || errorInfoReason(t, err) != rpcerrors.ReasonBrandMarkTermsNotAccepted {
		t.Fatalf("UploadTenantBrandMark = %v, want failed_precondition %s", err, rpcerrors.ReasonBrandMarkTermsNotAccepted)
	}
	assertExpectations(t, mock)
}

func TestUploadTenantBrandMarkRejectsAnInvalidField(t *testing.T) {
	valid := func() *publiraadminv1.UploadTenantBrandMarkRequest {
		return &publiraadminv1.UploadTenantBrandMarkRequest{
			Kind:             publirattypesv1.TenantBrandMarkKind_TENANT_BRAND_MARK_KIND_LINE_SHARE,
			ImageData:        testSquarePNG(t, 64),
			ImageContentType: "image/png",
			TermsUrl:         "https://example.com/guidelines",
			TermsAccepted:    true,
		}
	}
	tests := map[string]func(*publiraadminv1.UploadTenantBrandMarkRequest){
		"unspecified kind": func(req *publiraadminv1.UploadTenantBrandMarkRequest) {
			req.Kind = publirattypesv1.TenantBrandMarkKind_TENANT_BRAND_MARK_KIND_UNSPECIFIED
		},
		"unknown kind": func(req *publiraadminv1.UploadTenantBrandMarkRequest) {
			req.Kind = publirattypesv1.TenantBrandMarkKind(99)
		},
		"plain http terms url": func(req *publiraadminv1.UploadTenantBrandMarkRequest) {
			req.TermsUrl = "http://example.com/guidelines"
		},
		"no image": func(req *publiraadminv1.UploadTenantBrandMarkRequest) {
			req.ImageData = nil
		},
		"not an image": func(req *publiraadminv1.UploadTenantBrandMarkRequest) {
			req.ImageData = []byte("%PDF-1.7")
			req.ImageContentType = "application/pdf"
		},
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			ts, mock := newTestAdminServer(t)
			now := time.Now()
			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "tenant_admin")
			expectTenantLookup(mock, tenantID, "TENANT001", now)
			expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")

			req := valid()
			req.Tenant = &publirattypesv1.TenantContext{TenantId: tenantID.String()}
			mutate(req)
			client := publiraadminv1connect.NewTenantBrandMarkServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
			_, err := client.UploadTenantBrandMark(testutil.WithBearer(context.Background(), sessionToken), req)
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("UploadTenantBrandMark code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
			}
			assertExpectations(t, mock)
		})
	}
}

func TestUploadTenantBrandMarkStoresTheImageWithItsConsentAndDropsTheOneItReplaces(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now().UTC().Truncate(time.Second)
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	previousImageID := uuid.MustParse("11111111-1111-4111-8111-111111111111")
	storedImageID := uuid.MustParse("22222222-2222-4222-8222-222222222222")
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "tenant_admin")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.LockTenantForUpdate)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(tenantID))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantBrandMarkImageID)).
		WithArgs(tenantID, "google_play_badge").
		WillReturnRows(sqlmock.NewRows([]string{"image_id"}).AddRow(previousImageID))
	createdImageID := &imageIDArgument{}
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.CreateTenantImage)).
		WithArgs(createdImageID, tenantID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "updated_at", "created_at"}).
			AddRow(storedImageID, tenantID, now, now))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.CreateTenantImageVariant)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "tenant_id", "tenant_image_id", "label", "variant_type", "storage_provider",
			"object_key", "content_type", "file_size_bytes", "width", "height", "created_at",
		}).AddRow(
			uuid.Must(uuid.NewV7()), tenantID, storedImageID,
			"original", "google_play_badge", "s3", "tenants/TENANT001/brand-marks/badge.png", "image/png",
			int64(1024), int32(64), int32(64), now,
		))
	mock.ExpectExec(regexp.QuoteMeta(dbmodels.UpsertTenantBrandMark)).
		WithArgs(tenantID, "google_play_badge", createdImageID, "https://example.com/guidelines", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta(dbmodels.DeleteTenantImage)).
		WithArgs(previousImageID, tenantID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	expectAdminAuditLogInsert(mock)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListTenantBrandMarks)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows([]string{
			"kind", "image_id", "image_updated_at", "terms_url", "terms_accepted_at",
			"terms_accepted_by_user_public_id", "terms_accepted_by_user_name",
		}).AddRow("google_play_badge", storedImageID, now, "https://example.com/guidelines", now, testUserPublicID, "Tenant Admin"))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListTenantImageVariantsByImageIDs)).
		WillReturnRows(sqlmock.NewRows([]string{
			"tenant_image_id", "variant_type", "label", "content_type", "file_size_bytes", "width", "height",
		}).AddRow(storedImageID, "google_play_badge", "original", "image/png", int64(1024), int32(64), int32(64)))
	mock.ExpectCommit()

	client := publiraadminv1connect.NewTenantBrandMarkServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	resp, err := client.UploadTenantBrandMark(testutil.WithBearer(context.Background(), sessionToken), &publiraadminv1.UploadTenantBrandMarkRequest{
		Tenant:           &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Kind:             publirattypesv1.TenantBrandMarkKind_TENANT_BRAND_MARK_KIND_GOOGLE_PLAY_BADGE,
		ImageData:        testSquarePNG(t, 64),
		ImageContentType: "image/png",
		TermsUrl:         "https://example.com/guidelines",
		TermsAccepted:    true,
	})
	if err != nil {
		t.Fatalf("UploadTenantBrandMark: %v", err)
	}
	want := "/images/tenants/" + storedImageID.String() + "/google_play_badge"
	if got := brandingImageURL(resp.BrandMark.GetMark().GetImageVariants()); got != want {
		t.Fatalf("variant url = %q, want %q", got, want)
	}
	if resp.BrandMark.GetTermsAcceptedByUserPublicId() != testUserPublicID {
		t.Fatalf("accepted by = %q, want %q", resp.BrandMark.GetTermsAcceptedByUserPublicId(), testUserPublicID)
	}
	assertExpectations(t, mock)
}

func TestDeleteTenantBrandMarkDropsTheMarkAndItsImage(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	imageID := uuid.MustParse("33333333-3333-4333-8333-333333333333")
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "tenant_admin")
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.LockTenantForUpdate)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(tenantID))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.DeleteTenantBrandMark)).
		WithArgs(tenantID, "apple_sign_in").
		WillReturnRows(sqlmock.NewRows([]string{"image_id"}).AddRow(imageID))
	mock.ExpectExec(regexp.QuoteMeta(dbmodels.DeleteTenantImage)).
		WithArgs(imageID, tenantID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	expectAdminAuditLogInsert(mock)
	mock.ExpectCommit()

	client := publiraadminv1connect.NewTenantBrandMarkServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	if _, err := client.DeleteTenantBrandMark(testutil.WithBearer(context.Background(), sessionToken), &publiraadminv1.DeleteTenantBrandMarkRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Kind:   publirattypesv1.TenantBrandMarkKind_TENANT_BRAND_MARK_KIND_APPLE_SIGN_IN,
	}); err != nil {
		t.Fatalf("DeleteTenantBrandMark: %v", err)
	}
	assertExpectations(t, mock)
}
