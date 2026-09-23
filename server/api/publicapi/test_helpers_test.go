package publicapi

import (
	"context"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"regexp"
	"slices"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/ageverification"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/emailsettings"
	"github.com/publira/publira/server/internal/pagination"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/storage"
	"github.com/publira/publira/server/internal/testutil"
)

func newTestPublicServer(t *testing.T) (*httptest.Server, sqlmock.Sqlmock) {
	t.Helper()
	// The development environment sets PUBLIRA_REVALIDATE_TOKEN, and a server
	// that picked it up would record an outbox event no expectation covers.
	t.Setenv("PUBLIRA_REVALIDATE_TOKEN", "")
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})
	server := httptest.NewServer(mustPublicHandler(t, db, dbmodels.New(db), nil))
	t.Cleanup(server.Close)
	return server, mock
}

// mustPublicHandler builds the handler the way the server does, so a test that
// is about the routes or the wiring exercises the real constructor. It fails
// the test when the environment holds flood control settings the server would
// refuse to start on.
func mustPublicHandler(t *testing.T, db *sql.DB, queries Querier, encryptor emailsettings.SecretManager) http.Handler {
	t.Helper()

	api, err := New(db, queries, encryptor, testutil.TokenManager())
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return handlerFromServer(api.server)
}

type testStorageProvider struct{}

func (p *testStorageProvider) Upload(_ context.Context, req storage.UploadRequest) (storage.UploadResult, error) {
	return storage.UploadResult{
		Provider:  "s3",
		ObjectKey: req.ObjectKey,
		URL:       "s3://" + req.ObjectKey,
		SizeBytes: int64(len(req.Data)),
	}, nil
}

func publicTenantColumns() []string {
	return []string{"id", "public_id", "domain", "name", "default_reading_period_hours", "created_at", "status", "admin_domain", "timezone", "default_locale"}
}

// episodeNeighbor is one row of the neighbour read GetEpisodeDetail performs
// once it has the episode: direction -1 is the episode before it in the series,
// 1 the one after.
type episodeNeighbor struct {
	direction int32
	// id is what the credit read that follows asks about, so a neighbour that
	// is credited has to be identified here as well as named.
	id         uuid.UUID
	publicID   string
	title      string
	orderIndex int32
	price      int32
	// isFree is the query's own answer, price 0 or an open free window, rather
	// than something a test derives from the price beside it.
	isFree bool
}

// expectEpisodeNeighborsLookup registers that read. Passing no neighbour is an
// episode with none, which is what the query returns at both ends of a series.
func expectEpisodeNeighborsLookup(
	mock sqlmock.Sqlmock,
	tenantID uuid.UUID,
	seriesID uuid.UUID,
	orderIndex int32,
	episodeID uuid.UUID,
	neighbors ...episodeNeighbor,
) {
	rows := sqlmock.NewRows([]string{"direction", "id", "public_id", "title", "order_index", "price", "is_free", "purchase_availability"})
	for _, neighbor := range neighbors {
		rows.AddRow(neighbor.direction, neighbor.id, neighbor.publicID, neighbor.title, neighbor.orderIndex, neighbor.price, neighbor.isFree, "all")
	}
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListPublishedEpisodeNeighborsForTenant)).
		WithArgs(tenantID, seriesID, orderIndex, episodeID, "web").
		WillReturnRows(rows)
}

// episodeCredit is one row of the credit read GetEpisodeDetail performs for
// the episode it was asked about and its neighbours together.
type episodeCredit struct {
	episodeID    uuid.UUID
	publicID     string
	name         string
	rolePublicID string
	roleName     string
}

// expectEpisodeCreditsLookup registers that read. Passing no credit is an
// episode nobody is credited on, which is what an episode of a series with no
// credits bakes.
func expectEpisodeCreditsLookup(mock sqlmock.Sqlmock, credits ...episodeCredit) {
	rows := sqlmock.NewRows([]string{"episode_id", "public_id", "name", "profile_text", "icon_image_id", "icon_image_updated_at", "role_public_id", "role_name", "display_order", "source", "share_bps"})
	for index, credit := range credits {
		rows.AddRow(credit.episodeID, credit.publicID, credit.name, nil, nil, nil, credit.rolePublicID, credit.roleName, int32(index), "series", int32(0))
	}
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListEpisodeCreatorsByEpisodeIDs)).
		WillReturnRows(rows)
}

func expectTenantLookup(mock sqlmock.Sqlmock, tenantID uuid.UUID, publicID string, now time.Time) {
	expectTenantLookupWithSettings(mock, tenantID, publicID, now, "UTC", "ja")
}

func expectTenantLookupWithTimezone(mock sqlmock.Sqlmock, tenantID uuid.UUID, publicID string, now time.Time, timezone string) {
	expectTenantLookupWithSettings(mock, tenantID, publicID, now, timezone, "ja")
}

func expectTenantLookupWithDefaultLocale(mock sqlmock.Sqlmock, tenantID uuid.UUID, publicID string, now time.Time, defaultLocale string) {
	expectTenantLookupWithSettings(mock, tenantID, publicID, now, "UTC", defaultLocale)
}

func expectTenantLookupWithSettings(mock sqlmock.Sqlmock, tenantID uuid.UUID, publicID string, now time.Time, timezone, defaultLocale string) {
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantByID)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows(publicTenantColumns()).
			AddRow(tenantID, publicID, "tenant.example", "Tenant", nil, now, "active", nil, timezone, defaultLocale))
}

// assertSeriesPublicIDs compares a series list against the public ids it should
// hold, in order. Order is the assertion in most of these cases, so a mismatch
// prints both lists rather than the first index that differs.
func assertSeriesPublicIDs(t *testing.T, items []*publirattypesv1.Series, want ...string) {
	t.Helper()

	got := seriesPublicIDs(items)
	if !slices.Equal(got, want) {
		t.Fatalf("series = %v, want %v", got, want)
	}
}

func contentRankingSnapshotColumns() []string {
	return []string{"id", "tenant_id", "ranking_key", "period_start", "period_end", "entity_type", "items", "algorithm_version", "computed_at"}
}

func contentEventColumns() []string {
	return []string{
		"id", "tenant_id", "event_type", "user_id", "anonymous_id", "actor_key",
		"series_id", "episode_id", "debounce_bucket", "rating_score",
		"source_table", "source_id", "payload", "occurred_at", "created_at",
	}
}

func assertPublicExpectations(t *testing.T, mock sqlmock.Sqlmock) {
	t.Helper()
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

// tenantConfigColumns is the tenant_config row a `SELECT *` reads back.
func tenantConfigColumns() []string {
	return []string{
		"tenant_id", "copyright_text", "site_description", "created_at", "updated_at",
		"site_tagline", "comment_mode", "comment_auto_hide_report_threshold",
		"episode_rating_mode", "age_verification", "purchase_availability",
		"app_store_url", "google_play_url", "terms_page_id", "privacy_page_id",
		"android_application_id", "android_sha256_cert_fingerprints", "ios_team_id", "ios_bundle_identifier",
	}
}

// expectTenantConfigRead stands in for one read of the tenant's settings row.
// Two answers come out of it and each is read on its own, so a handler that
// needs both makes two of these.
func expectTenantConfigRead(mock sqlmock.Sqlmock, tenantID uuid.UUID, now time.Time, commentMode, ageRule string) {
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantConfigByTenantID)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows(tenantConfigColumns()).
			AddRow(tenantID, nil, nil, now, now, nil, commentMode, int32(3), "single", ageRule, "all", nil, nil, nil, nil, nil, "{}", nil, nil))
}

// expectTenantAgeVerification stands in for the tenant config read a rated
// series makes. Only a series that carries a rating causes it, so a test that
// sets none up is asserting the read never happened.
func expectTenantAgeVerification(mock sqlmock.Sqlmock, tenantID uuid.UUID, now time.Time, rule string) {
	expectTenantConfigRead(mock, tenantID, now, "disabled", rule)
}

// expectTenantCommentMode stands in for the tenant config read a series that
// states no comment mode of its own makes. A series carrying an override
// answers without it, so a test that sets none up is asserting the read never
// happened.
func expectTenantCommentMode(mock sqlmock.Sqlmock, tenantID uuid.UUID, now time.Time, mode string) {
	expectTenantConfigRead(mock, tenantID, now, mode, ageverification.None)
}

// expectSeriesRating stands in for the derived figure every series detail read
// carries. It is matched by the query's name rather than by a copy of its text:
// the query is one aggregate over the daily stats and the tally beside them,
// and no handler test turns on how it is written.
func expectSeriesRating(mock sqlmock.Sqlmock, tenantID, seriesID uuid.UUID, average float64, count int64) {
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetSeriesRating)).
		WithArgs(tenantID, seriesID).
		WillReturnRows(sqlmock.NewRows([]string{"rating_count", "rating_average"}).AddRow(count, average))
}

// webToken builds a catalog token the way a read from the storefront hands one
// back: the surface it was built on, then the list's own keys.
func webToken(direction pagination.Direction, keys ...string) string {
	return pagination.Encode(direction, append([]string{"surface:web"}, keys...)...)
}

// onWeb binds an encoded token to the storefront, the way a read from it hands
// one back.
func onWeb(token string) string {
	bindSurfaceTokens("web", &token)
	return token
}
