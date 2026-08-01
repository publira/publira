package publicapi

import (
	"context"
	"net/http/httptest"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/storage"
)

const (
	getTenantByPublicIDQuery               = "-- name: GetTenantByPublicID :one\nSELECT id, public_id, domain, name, default_reading_period_hours, created_at, status, admin_domain\nFROM tenants\nWHERE public_id = $1\nLIMIT 1\n"
	listActiveSeriesQuery                  = "-- name: ListActiveSeries :many\nSELECT s.id,\n    s.public_id,\n    s.title,\n    sl.synopsis,\n    s.published_at,\n    s.eye_catch_image_id,\n    NULL::timestamp AS eye_catch_image_updated_at,\n    COALESCE(\n        json_agg(\n            json_build_object(\n                'public_id',\n                c.public_id,\n                'name',\n                c.name,\n                'role',\n                sc.role,\n                'profile_text',\n                c.profile_text,\n                'icon_image_url',\n                CASE\n                    WHEN c.icon_image_id IS NOT NULL THEN '/images/creators/' || c.icon_image_id::text\n                    ELSE ''\n                END,\n                'icon_image_file_size_bytes',\n                0,\n                'icon_image_updated_at',\n                COALESCE(ci.updated_at::TEXT, '')\n            )\n            ORDER BY sc.display_order ASC\n        ) FILTER (\n            WHERE c.id IS NOT NULL\n        ),\n        '[]'\n    )::jsonb AS creators,\n    CASE\n        WHEN l.public_id IS NOT NULL THEN json_build_object(\n            'public_id',\n            l.public_id,\n            'name',\n            l.name\n        )\n        ELSE '{}'::json\n    END::jsonb AS label_info\nFROM series s\n    LEFT JOIN series_listings sl ON sl.series_id = s.id\n    LEFT JOIN labels l ON s.label_id = l.id\n    LEFT JOIN series_creators sc ON s.id = sc.series_id\n    LEFT JOIN creators c ON sc.creator_id = c.id\n    LEFT JOIN creator_images ci ON ci.id = c.icon_image_id\nWHERE s.tenant_id = $1\n    AND s.is_published = true\n    AND s.published_at IS NOT NULL\n    AND s.published_at <= NOW()\nGROUP BY s.id,\n    sl.series_id,\n    sl.synopsis,\n    l.public_id,\n    l.name\nORDER BY s.published_at DESC\nLIMIT $2 OFFSET $3\n"
	getSeriesDetailQuery                   = "-- name: GetSeriesDetail :one\nSELECT s.id,\n    s.public_id,\n    s.title,\n    l.public_id AS label_public_id,\n    l.name AS label_name,\n    s.eye_catch_image_id,\n    NULL::timestamp AS eye_catch_image_updated_at,\n    sl.synopsis,\n    s.is_published,\n    s.published_at,\n    -- 複数の著者情報をJSON配列として1カラムにまとめる\n    COALESCE(\n        json_agg(\n            json_build_object(\n                    'public_id',\n                    c.public_id,\n                'name',\n                c.name,\n                    'role',\n                    sc.role,\n                    'profile_text',\n                    c.profile_text,\n                    'icon_image_url',\n                    CASE\n                        WHEN c.icon_image_id IS NOT NULL THEN '/images/creators/' || c.icon_image_id::text\n                        ELSE ''\n                    END,\n                    'icon_image_file_size_bytes',\n                    0,\n                    'icon_image_updated_at',\n                    COALESCE(ci.updated_at::TEXT, '')\n            )\n            ORDER BY sc.display_order ASC\n        ) FILTER (\n            WHERE c.id IS NOT NULL\n        ),\n        '[]'\n    )::jsonb AS creators,\n    COALESCE(\n        (\n            SELECT json_agg(\n                    json_build_object(\n                        'public_id',\n                        e.public_id,\n                        'title',\n                        e.title,\n                        'order_index',\n                        e.order_index,\n                        'price',\n                        el.price,\n                        'reading_period_hours',\n                        el.reading_period_hours,\n                        'status',\n                        el.status,\n                        'scheduled_at',\n                        el.scheduled_at,\n                        'published_at',\n                        el.published_at\n                    )\n                    ORDER BY e.order_index ASC\n                )\n            FROM episodes e\n                JOIN episode_listings el ON el.episode_id = e.id\n            WHERE e.series_id = s.id\n                AND el.status = 'published'\n                AND el.published_at IS NOT NULL\n                AND el.published_at <= NOW()\n        ),\n        '[]'\n    )::jsonb AS episodes\nFROM series s\n    LEFT JOIN series_listings sl ON sl.series_id = s.id\n    LEFT JOIN labels l ON s.label_id = l.id\n    LEFT JOIN series_creators sc ON s.id = sc.series_id\n    LEFT JOIN creators c ON sc.creator_id = c.id\n    LEFT JOIN creator_images ci ON ci.id = c.icon_image_id\nWHERE s.public_id = $1\n    AND s.tenant_id = $2\nGROUP BY s.id,\n    l.id,\n    sl.series_id,\n    sl.synopsis\n"
	listSeriesImageVariantsByImageIDsQuery = "-- name: ListSeriesImageVariantsByImageIDs :many\nSELECT series_image_id,\n    variant_type,\n    label,\n    content_type,\n    file_size_bytes,\n    width,\n    height\nFROM series_image_variants\nWHERE series_image_id = ANY($1::uuid[])\nORDER BY series_image_id,\n    variant_type,\n    width\n"
	getPublishedEpisodeByPublicIDQuery     = "-- name: GetPublishedEpisodeByPublicIDForTenant :one\nSELECT e.id,\n    e.public_id,\n    e.title,\n    e.order_index,\n    el.price,\n    el.reading_period_hours,\n    el.status,\n    el.scheduled_at,\n    el.published_at,\n    s.public_id AS series_public_id,\n    s.title AS series_title\nFROM episodes e\n    JOIN series s ON s.id = e.series_id\n    JOIN episode_listings el ON el.episode_id = e.id\nWHERE s.tenant_id = $1\n    AND e.public_id = $2\n    AND s.is_published = true\n    AND s.published_at IS NOT NULL\n    AND s.published_at <= NOW()\n    AND el.status = 'published'\n    AND el.published_at IS NOT NULL\n    AND el.published_at <= NOW()\nLIMIT 1\n"
	listPublishedPagesForTenantQuery       = "-- name: ListPublishedPagesForTenant :many\nSELECT p.id, p.tenant_id, p.slug, p.title, p.published_version_id, p.created_at, p.updated_at\nFROM pages p\n    JOIN page_versions pv ON pv.id = p.published_version_id\nWHERE p.tenant_id = $1\n    AND pv.status = 'published'\n    AND pv.published_at IS NOT NULL\n    AND pv.published_at <= NOW()\nORDER BY p.created_at ASC\n"
	getPublishedPageBySlugQuery            = "-- name: GetPublishedPageBySlugForTenant :one\nSELECT p.id,\n    p.tenant_id,\n    p.slug,\n    p.title,\n    p.published_version_id,\n    p.created_at,\n    p.updated_at,\n    pv.id AS version_id,\n    pv.page_id,\n    pv.version_number,\n    pv.content_markdown,\n    pv.author_user_id,\n    pv.status,\n    pv.publish_at,\n    pv.created_at AS version_created_at,\n    pv.published_at\nFROM pages p\n    JOIN page_versions pv ON pv.id = p.published_version_id\nWHERE p.tenant_id = $1\n    AND p.slug = $2\n    AND pv.status = 'published'\n    AND pv.published_at IS NOT NULL\n    AND pv.published_at <= NOW()\nLIMIT 1\n"
	listEpisodeImagesByEpisodeIDQuery      = "-- name: ListEpisodeImagesByEpisodeID :many\nSELECT\n    ei.id,\n    ei.tenant_id,\n    ei.episode_id,\n    ei.display_order,\n    ei.created_at,\n    eiv.content_type,\n    eiv.file_size_bytes,\n    eiv.width,\n    eiv.height\nFROM episode_images ei\nJOIN LATERAL (\n    SELECT content_type, file_size_bytes, width, height\n    FROM episode_image_variants\n    WHERE episode_image_id = ei.id\n    ORDER BY width DESC\n    LIMIT 1\n) eiv ON true\nWHERE ei.episode_id = $1\nORDER BY ei.display_order ASC,\n    ei.created_at ASC\n"
)

func newTestPublicServer(t *testing.T) (*httptest.Server, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})
	server := httptest.NewServer(NewHandler(db, dbmodels.New(db), &testStorageProvider{}, nil, nil))
	t.Cleanup(server.Close)
	return server, mock
}

type testStorageProvider struct{}

func (p *testStorageProvider) Upload(_ context.Context, req storage.UploadRequest) (storage.UploadResult, error) {
	return storage.UploadResult{
		Provider:  "local",
		ObjectKey: req.ObjectKey,
		URL:       "local://" + req.ObjectKey,
		SizeBytes: int64(len(req.Data)),
	}, nil
}

func expectTenantLookup(mock sqlmock.Sqlmock, tenantID uuid.UUID, publicID string, now time.Time) {
	mock.ExpectQuery(regexp.QuoteMeta(getTenantByPublicIDQuery)).
		WithArgs(publicID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "domain", "name", "default_reading_period_hours", "created_at", "status", "admin_domain"}).
			AddRow(tenantID, publicID, "tenant.example", "Tenant", nil, now, "active", nil))
}

func assertPublicExpectations(t *testing.T, mock sqlmock.Sqlmock) {
	t.Helper()
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}
