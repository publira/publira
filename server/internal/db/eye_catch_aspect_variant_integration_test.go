package dbmodels_test

import (
	"context"
	"database/sql"
	"strconv"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/testutil"
)

// An eye-catch holds one image per aspect ratio and the ratios are
// independent, so replacing one has to leave the others exactly as they were.
// That isolation is the clearing query's job: it is scoped to a single
// variant_type, and everything else about the eye-catch is untouched.
func TestDeleteSeriesImageVariantsByTypeLeavesTheOtherRatios(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	db := pg.DB
	q := dbmodels.New(db)

	tenantID := mustInsertTenant(t, ctx, db, "TENANTVAR001", "var.example.com", "admin-var.example.com", "Variant Tenant")
	seriesID := mustInsertSeries(t, ctx, db, tenantID, "SERIESVAR001")
	imageID := mustInsertSeriesImage(t, ctx, db, tenantID, seriesID)

	mustInsertSeriesImageVariant(t, ctx, db, tenantID, imageID, "landscape", 800, 450)
	mustInsertSeriesImageVariant(t, ctx, db, tenantID, imageID, "landscape", 1600, 900)
	mustInsertSeriesImageVariant(t, ctx, db, tenantID, imageID, "portrait", 1200, 1600)

	removed, err := q.DeleteSeriesImageVariantsByType(ctx, dbmodels.DeleteSeriesImageVariantsByTypeParams{
		SeriesImageID: imageID,
		VariantType:   "landscape",
	})
	if err != nil {
		t.Fatalf("DeleteSeriesImageVariantsByType: %v", err)
	}
	if removed != 2 {
		t.Fatalf("deleted %d rows, want 2", removed)
	}

	rows, err := q.ListSeriesImageVariantsByImageIDs(ctx, []uuid.UUID{imageID})
	if err != nil {
		t.Fatalf("ListSeriesImageVariantsByImageIDs: %v", err)
	}
	if len(rows) != 1 || rows[0].VariantType != "portrait" {
		t.Fatalf("remaining variants = %v, want only the portrait one", rows)
	}

	// The replacement lands under the same (image, ratio, width) the delivery
	// URL names, so the URL keeps resolving after a ratio is swapped.
	mustInsertSeriesImageVariant(t, ctx, db, tenantID, imageID, "landscape", 1600, 900)
	variant, err := q.GetSeriesImageVariantByTypeAndWidthForTenant(ctx, dbmodels.GetSeriesImageVariantByTypeAndWidthForTenantParams{
		SeriesImageID: imageID,
		TenantID:      tenantID,
		VariantType:   "landscape",
		Width:         1600,
	})
	if err != nil {
		t.Fatalf("GetSeriesImageVariantByTypeAndWidthForTenant: %v", err)
	}
	if variant.ObjectKey != objectKeyFor("landscape", 1600) {
		t.Fatalf("object_key = %q, want the replacement", variant.ObjectKey)
	}
}

// A ratio upload bumps the eye-catch's updated_at, which is what the console
// reads back and what the delivered URL is cache-busted on.
func TestTouchSeriesImageMovesUpdatedAt(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	db := pg.DB
	q := dbmodels.New(db)

	tenantID := mustInsertTenant(t, ctx, db, "TENANTVAR002", "var2.example.com", "admin-var2.example.com", "Variant Tenant 2")
	seriesID := mustInsertSeries(t, ctx, db, tenantID, "SERIESVAR002")
	imageID := mustInsertSeriesImage(t, ctx, db, tenantID, seriesID)

	var before time.Time
	if err := db.QueryRowContext(ctx, `SELECT updated_at FROM series_images WHERE id = $1`, imageID).Scan(&before); err != nil {
		t.Fatalf("read updated_at: %v", err)
	}
	if _, err := db.ExecContext(ctx, `UPDATE series_images SET updated_at = updated_at - interval '1 hour' WHERE id = $1`, imageID); err != nil {
		t.Fatalf("age the row: %v", err)
	}

	if err := q.TouchSeriesImage(ctx, imageID); err != nil {
		t.Fatalf("TouchSeriesImage: %v", err)
	}

	var after time.Time
	if err := db.QueryRowContext(ctx, `SELECT updated_at FROM series_images WHERE id = $1`, imageID).Scan(&after); err != nil {
		t.Fatalf("read updated_at after touch: %v", err)
	}
	if !after.After(before.Add(-time.Minute)) {
		t.Fatalf("updated_at = %v, want it moved back up to about %v", after, before)
	}
}

func objectKeyFor(variantType string, width int) string {
	return "tenants/TENANT/" + variantType + "/" + strconv.Itoa(width)
}

func mustInsertSeriesImage(t *testing.T, ctx context.Context, db *sql.DB, tenantID, seriesID uuid.UUID) uuid.UUID {
	t.Helper()
	imageID, err := uuid.NewV7()
	if err != nil {
		t.Fatalf("uuid: %v", err)
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO series_images (id, tenant_id, series_id) VALUES ($1, $2, $3)
	`, imageID, tenantID, seriesID)
	if err != nil {
		t.Fatalf("insert series image: %v", err)
	}
	_, err = db.ExecContext(ctx, `UPDATE series SET eye_catch_image_id = $2 WHERE id = $1`, seriesID, imageID)
	if err != nil {
		t.Fatalf("point series at its eye catch image: %v", err)
	}
	return imageID
}

func mustInsertSeriesImageVariant(t *testing.T, ctx context.Context, db *sql.DB, tenantID, imageID uuid.UUID, variantType string, width, height int32) {
	t.Helper()
	variantID, err := uuid.NewV7()
	if err != nil {
		t.Fatalf("uuid: %v", err)
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO series_image_variants (
			id, tenant_id, series_image_id, label, variant_type,
			storage_provider, object_key, content_type, file_size_bytes, width, height
		)
		VALUES ($1, $2, $3, $4, $5, 's3', $6, 'image/jpeg', 4096, $7, $8)
	`,
		variantID, tenantID, imageID,
		variantType, variantType,
		objectKeyFor(variantType, int(width)),
		width, height,
	)
	if err != nil {
		t.Fatalf("insert %s variant: %v", variantType, err)
	}
}
