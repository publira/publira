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
	getTenantByPublicIDQuery           = "-- name: GetTenantByPublicID :one\nSELECT id, public_id, domain, name, default_reading_period_hours, created_at, status, admin_domain\nFROM tenants\nWHERE public_id = $1\nLIMIT 1\n"
	listActiveSeriesQuery              = "-- name: ListActiveSeries :many\nSELECT s.id,\n    s.public_id,\n    s.title,\n    sl.synopsis,\n    s.published_at,\n    COALESCE(\n        json_agg(\n            json_build_object(\n                'public_id',\n                c.public_id,\n                'name',\n                c.name,\n                'role',\n                sc.role,\n                'profile_text',\n                c.profile_text\n            )\n            ORDER BY sc.display_order ASC\n        ) FILTER (\n            WHERE c.id IS NOT NULL\n        ),\n        '[]'\n    )::jsonb AS creators\nFROM series s\n    LEFT JOIN series_listings sl ON sl.series_id = s.id\n    LEFT JOIN series_creators sc ON s.id = sc.series_id\n    LEFT JOIN creators c ON sc.creator_id = c.id\nWHERE s.tenant_id = $1\n    AND s.is_published = true\n    AND s.published_at IS NOT NULL\n    AND s.published_at <= NOW()\nGROUP BY s.id,\n    sl.series_id,\n    sl.synopsis\nORDER BY s.published_at DESC\nLIMIT $2 OFFSET $3\n"
	getSeriesDetailQuery               = "-- name: GetSeriesDetail :one\nSELECT s.id,\n    s.public_id,\n    s.title,\n    l.name AS label_name,\n    sl.synopsis,\n    s.is_published,\n    s.published_at,\n    -- 複数の著者情報をJSON配列として1カラムにまとめる\n    COALESCE(\n        json_agg(\n            json_build_object(\n                'public_id',\n                c.public_id,\n                'name',\n                c.name,\n                'role',\n                sc.role,\n                'profile_text',\n                c.profile_text\n            )\n            ORDER BY sc.display_order ASC\n        ) FILTER (\n            WHERE c.id IS NOT NULL\n        ),\n        '[]'\n    )::jsonb AS creators,\n    COALESCE(\n        (\n            SELECT json_agg(\n                    json_build_object(\n                        'public_id',\n                        e.public_id,\n                        'title',\n                        e.title,\n                        'order_index',\n                        e.order_index,\n                        'price',\n                        el.price,\n                        'reading_period_hours',\n                        el.reading_period_hours,\n                        'status',\n                        el.status,\n                        'scheduled_at',\n                        el.scheduled_at,\n                        'published_at',\n                        el.published_at\n                    )\n                    ORDER BY e.order_index ASC\n                )\n            FROM episodes e\n                JOIN episode_listings el ON el.episode_id = e.id\n            WHERE e.series_id = s.id\n                AND el.status = 'published'\n                AND el.published_at IS NOT NULL\n                AND el.published_at <= NOW()\n        ),\n        '[]'\n    )::jsonb AS episodes\nFROM series s\n    LEFT JOIN series_listings sl ON sl.series_id = s.id\n    LEFT JOIN labels l ON s.label_id = l.id\n    LEFT JOIN series_creators sc ON s.id = sc.series_id\n    LEFT JOIN creators c ON sc.creator_id = c.id\nWHERE s.public_id = $1\n    AND s.tenant_id = $2\nGROUP BY s.id,\n    l.id,\n    sl.series_id,\n    sl.synopsis\n"
	getPublishedEpisodeByPublicIDQuery = "-- name: GetPublishedEpisodeByPublicIDForTenant :one\nSELECT e.id,\n    e.public_id,\n    e.title,\n    e.order_index,\n    el.price,\n    el.reading_period_hours,\n    el.status,\n    el.scheduled_at,\n    el.published_at,\n    s.public_id AS series_public_id,\n    s.title AS series_title\nFROM episodes e\n    JOIN series s ON s.id = e.series_id\n    JOIN episode_listings el ON el.episode_id = e.id\nWHERE s.tenant_id = $1\n    AND e.public_id = $2\n    AND s.is_published = true\n    AND s.published_at IS NOT NULL\n    AND s.published_at <= NOW()\n    AND el.status = 'published'\n    AND el.published_at IS NOT NULL\n    AND el.published_at <= NOW()\nLIMIT 1\n"
	listEpisodeImagesByEpisodeIDQuery  = "-- name: ListEpisodeImagesByEpisodeID :many\nSELECT\n    ei.id,\n    ei.tenant_id,\n    ei.episode_id,\n    ei.display_order,\n    ei.created_at,\n    eiv.content_type,\n    eiv.file_size_bytes,\n    eiv.width,\n    eiv.height\nFROM episode_images ei\nJOIN LATERAL (\n    SELECT content_type, file_size_bytes, width, height\n    FROM episode_image_variants\n    WHERE episode_image_id = ei.id\n    ORDER BY width DESC\n    LIMIT 1\n) eiv ON true\nWHERE ei.episode_id = $1\nORDER BY ei.display_order ASC,\n    ei.created_at ASC\n"
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
