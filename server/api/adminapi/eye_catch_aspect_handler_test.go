package adminapi

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/jpeg"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
	"github.com/publira/publira/server/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
)

const (
	createSeriesImageVariantQuery          = "-- name: CreateSeriesImageVariant :one\n"
	deleteSeriesImageVariantsByTypeQuery   = "-- name: DeleteSeriesImageVariantsByType :execrows\n"
	touchSeriesImageQuery                  = "-- name: TouchSeriesImage :exec\n"
	listSeriesImageVariantsByImageIDsQuery = "-- name: ListSeriesImageVariantsByImageIDs :many\n"
	createLabelImageVariantQuery           = "-- name: CreateLabelImageVariant :one\n"
	deleteLabelImageVariantsByTypeQuery    = "-- name: DeleteLabelImageVariantsByType :execrows\n"
	touchLabelImageQuery                   = "-- name: TouchLabelImage :exec\n"
)

// aspectJPEG encodes a plain JPEG of the given size. A ratio upload is checked
// against that ratio's minimum, which the 1x1 fixtures cannot meet.
func aspectJPEG(t *testing.T, width, height int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := range height {
		for x := range width {
			img.Set(x, y, color.RGBA{R: uint8(x % 256), G: uint8(y % 256), B: 0x40, A: 0xff})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, nil); err != nil {
		t.Fatalf("jpeg.Encode: %v", err)
	}
	return buf.Bytes()
}

func seriesRowColumns() []string {
	return []string{
		"id", "public_id", "title", "label_public_id", "label_name", "synopsis",
		"reading_period_hours", "is_published", "published_at",
		"eye_catch_image_id", "eye_catch_image_updated_at", "eye_catch_image_file_size_bytes",
	}
}

func labelRowColumns() []string {
	return []string{"id", "tenant_id", "public_id", "name", "created_at", "eye_catch_image_id", "eye_catch_image_updated_at"}
}

func eyeCatchVariantColumns(imageIDColumn string) []string {
	return []string{imageIDColumn, "variant_type", "label", "content_type", "file_size_bytes", "width", "height"}
}

// createdImageVariantRow stands in for the `RETURNING *` of an image variant
// insert. The handler discards the row, so only its shape has to line up.
func createdImageVariantRow(imageIDColumn string, tenantID, imageID uuid.UUID, variantType string, now time.Time) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "tenant_id", imageIDColumn, "label", "variant_type", "storage_provider",
		"object_key", "content_type", "file_size_bytes", "width", "height", "created_at",
	}).AddRow(
		uuid.Must(uuid.NewV7()), tenantID, imageID, variantType+"_1200w", variantType, "s3",
		"tenants/TENANT/key", "image/jpeg", int64(4096), int32(1200), int32(1200), now,
	)
}

func TestUploadSeriesEyeCatchAspectImageReplacesOnlyThatRatio(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	seriesID := uuid.Must(uuid.NewV7())
	imageID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	mock.ExpectQuery(regexp.QuoteMeta(getSeriesByPublicIDForTenantQuery)).
		WithArgs(tenantID, "SERIES001").
		WillReturnRows(sqlmock.NewRows(seriesRowColumns()).
			AddRow(seriesID, "SERIES001", "Title", nil, nil, "Synopsis", nil, true, now, imageID, now, int64(0)))

	mock.ExpectBegin()
	// Only the requested ratio is cleared; the other three keep their rows.
	mock.ExpectExec(regexp.QuoteMeta(deleteSeriesImageVariantsByTypeQuery)).
		WithArgs(imageID, "landscape").
		WillReturnResult(sqlmock.NewResult(0, 3))
	// landscape is delivered at 800 / 1200 / 1600 px wide.
	for range 3 {
		mock.ExpectQuery(regexp.QuoteMeta(createSeriesImageVariantQuery)).
			WillReturnRows(createdImageVariantRow("series_image_id", tenantID, imageID, "landscape", now))
	}
	mock.ExpectExec(regexp.QuoteMeta(touchSeriesImageQuery)).
		WithArgs(imageID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	expectAdminAuditLogInsert(mock)

	mock.ExpectQuery(regexp.QuoteMeta(getSeriesByPublicIDForTenantQuery)).
		WithArgs(tenantID, "SERIES001").
		WillReturnRows(sqlmock.NewRows(seriesRowColumns()).
			AddRow(seriesID, "SERIES001", "Title", nil, nil, "Synopsis", nil, true, now, imageID, now, int64(0)))
	mock.ExpectQuery("SELECT sc.series_id").
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"series_id", "public_id", "name", "role", "display_order"}))
	mock.ExpectQuery(regexp.QuoteMeta(listSeriesImageVariantsByImageIDsQuery)).
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows(eyeCatchVariantColumns("series_image_id")).
			AddRow(imageID, "landscape", "landscape_1600w", "image/jpeg", int64(4096), int32(1600), int32(900)).
			AddRow(imageID, "portrait", "portrait_1200w", "image/jpeg", int64(4096), int32(1200), int32(1600)))

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.UploadSeriesEyeCatchAspectImageRequest{
		Tenant:           &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId:         "SERIES001",
		VariantType:      "landscape",
		ImageData:        aspectJPEG(t, 1600, 900),
		ImageContentType: "image/jpeg",
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	resp, err := client.UploadSeriesEyeCatchAspectImage(context.Background(), req)
	if err != nil {
		t.Fatalf("UploadSeriesEyeCatchAspectImage: %v", err)
	}
	ratios := map[string]bool{}
	for _, variant := range resp.Msg.Series.GetEyeCatchImageVariants() {
		ratios[variant.GetVariantType()] = true
	}
	if !ratios["landscape"] || !ratios["portrait"] {
		t.Fatalf("variant types = %v, want both landscape and portrait", ratios)
	}
	assertExpectations(t, mock)
}

func TestUploadSeriesEyeCatchAspectImageRequiresAnExistingEyeCatch(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	seriesID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	mock.ExpectQuery(regexp.QuoteMeta(getSeriesByPublicIDForTenantQuery)).
		WithArgs(tenantID, "SERIES001").
		WillReturnRows(sqlmock.NewRows(seriesRowColumns()).
			AddRow(seriesID, "SERIES001", "Title", nil, nil, "Synopsis", nil, true, now, nil, nil, int64(0)))

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.UploadSeriesEyeCatchAspectImageRequest{
		Tenant:           &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId:         "SERIES001",
		VariantType:      "landscape",
		ImageData:        aspectJPEG(t, 1600, 900),
		ImageContentType: "image/jpeg",
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	_, err := client.UploadSeriesEyeCatchAspectImage(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("error code = %v, want failed_precondition (err: %v)", connect.CodeOf(err), err)
	}
	assertExpectations(t, mock)
}

func TestUploadSeriesEyeCatchAspectImageRejectsAnUnknownRatio(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.UploadSeriesEyeCatchAspectImageRequest{
		Tenant:           &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId:         "SERIES001",
		VariantType:      "banner",
		ImageData:        aspectJPEG(t, 1600, 900),
		ImageContentType: "image/jpeg",
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	_, err := client.UploadSeriesEyeCatchAspectImage(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("error code = %v, want invalid_argument (err: %v)", connect.CodeOf(err), err)
	}
	assertExpectations(t, mock)
}

func TestUploadSeriesEyeCatchAspectImageRejectsASourceBelowTheRatioMinimum(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	seriesID := uuid.Must(uuid.NewV7())
	imageID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	mock.ExpectQuery(regexp.QuoteMeta(getSeriesByPublicIDForTenantQuery)).
		WithArgs(tenantID, "SERIES001").
		WillReturnRows(sqlmock.NewRows(seriesRowColumns()).
			AddRow(seriesID, "SERIES001", "Title", nil, nil, "Synopsis", nil, true, now, imageID, now, int64(0)))

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.UploadSeriesEyeCatchAspectImageRequest{
		Tenant:           &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId:         "SERIES001",
		VariantType:      "landscape",
		ImageData:        aspectJPEG(t, 800, 450),
		ImageContentType: "image/jpeg",
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	_, err := client.UploadSeriesEyeCatchAspectImage(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("error code = %v, want invalid_argument (err: %v)", connect.CodeOf(err), err)
	}
	assertExpectations(t, mock)
}

func TestUploadLabelEyeCatchAspectImageReplacesOnlyThatRatio(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	labelID := uuid.Must(uuid.NewV7())
	imageID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	mock.ExpectQuery(regexp.QuoteMeta(getLabelByPublicIDForTenantQuery)).
		WithArgs(tenantID, "LABEL001").
		WillReturnRows(sqlmock.NewRows(labelRowColumns()).
			AddRow(labelID, tenantID, "LABEL001", "Weekly", now, imageID, now))

	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(deleteLabelImageVariantsByTypeQuery)).
		WithArgs(imageID, "square").
		WillReturnResult(sqlmock.NewResult(0, 3))
	// square is delivered at 600 / 900 / 1200 px wide.
	for range 3 {
		mock.ExpectQuery(regexp.QuoteMeta(createLabelImageVariantQuery)).
			WillReturnRows(createdImageVariantRow("label_image_id", tenantID, imageID, "square", now))
	}
	mock.ExpectExec(regexp.QuoteMeta(touchLabelImageQuery)).
		WithArgs(imageID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	expectAdminAuditLogInsert(mock)

	mock.ExpectQuery(regexp.QuoteMeta(getLabelByPublicIDForTenantQuery)).
		WithArgs(tenantID, "LABEL001").
		WillReturnRows(sqlmock.NewRows(labelRowColumns()).
			AddRow(labelID, tenantID, "LABEL001", "Weekly", now, imageID, now))
	mock.ExpectQuery(regexp.QuoteMeta(listLabelImageVariantsByImageIDsQuery)).
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows(eyeCatchVariantColumns("label_image_id")).
			AddRow(imageID, "square", "square_1200w", "image/jpeg", int64(4096), int32(1200), int32(1200)))

	client := publiraadminv1connect.NewAdminLabelServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.UploadLabelEyeCatchAspectImageRequest{
		Tenant:           &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId:         "LABEL001",
		VariantType:      "square",
		ImageData:        aspectJPEG(t, 1200, 1200),
		ImageContentType: "image/jpeg",
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	resp, err := client.UploadLabelEyeCatchAspectImage(context.Background(), req)
	if err != nil {
		t.Fatalf("UploadLabelEyeCatchAspectImage: %v", err)
	}
	variants := resp.Msg.Label.GetEyeCatchImageVariants()
	if len(variants) != 1 || variants[0].GetVariantType() != "square" {
		t.Fatalf("variants = %v, want a single square variant", variants)
	}
	assertExpectations(t, mock)
}
