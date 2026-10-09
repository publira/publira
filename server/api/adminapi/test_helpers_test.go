package adminapi

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"log/slog"
	"maps"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"regexp"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/emailsettings"
	"github.com/publira/publira/server/internal/mailguard"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/platformpolicy"
	"github.com/publira/publira/server/internal/ratelimit"
	"github.com/publira/publira/server/internal/revalidate"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
	"github.com/publira/publira/server/internal/storage"
	"github.com/publira/publira/server/internal/testutil"
)

const (
	testUserPublicID = "USER001"
)

func newTestAdminServer(t *testing.T) (*httptest.Server, sqlmock.Sqlmock) {
	t.Helper()
	return newTestAdminServerWithStorage(t, &testStorageProvider{})
}

// newTestAdminServerWithStorage builds the same server against a chosen
// storage provider, so a test that cares what was uploaded can pass one that
// keeps the bytes.
func newTestAdminServerWithStorage(t *testing.T, provider storage.Provider) (*httptest.Server, sqlmock.Sqlmock) {
	t.Helper()
	disableRevalidationUnlessRecorded(t)
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})
	completions, _, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() {
		_ = completions.Close()
	})
	api, err := newTestAPI(db, completions, dbmodels.New(db), provider, slog.Default(), nil, nil)
	if err != nil {
		t.Fatalf("new admin handler: %v", err)
	}
	server := httptest.NewServer(handlerFromServer(api.server))
	t.Cleanup(server.Close)
	return server, mock
}

// newTestHandler builds the handler the way NewHandler does, with the limit on
// the mail the console's forms cause given rather than read from the
// environment: the counters would otherwise be the deployment's shared Redis,
// where one run of these tests would charge the budget of the next.
func newTestHandler(
	db *sql.DB,
	queries Querier,
	storageProvider storage.Provider,
	logger *slog.Logger,
	encryptor emailsettings.SecretManager,
	tester internalsmtp.Tester,
) (http.Handler, error) {
	api, err := newTestAPI(db, nil, queries, storageProvider, logger, encryptor, tester)
	if err != nil {
		return nil, err
	}
	return handlerFromServer(api.server), nil
}

// newTestAPI is newTestHandler's server, with completions as the database the
// revalidate requester marks a sent invalidation done on; nil leaves it on db.
//
// The completion runs on the requester's own goroutine once the recorder has
// answered, while the handler goes on with what it does after its commit on
// db, whose sqlmock expectations are ordered. Sharing db, whichever of the two
// reaches it first takes the expectation the other was owed, so a test that
// expects a statement after the commit passes or fails on scheduling alone.
// On a database of its own the completion reaches none of them. It finds no
// expectation there either and gives up, which costs nothing: what these tests
// assert is the tags each write sends and the outbox row it records, and
// marking that row done is the requester's own behaviour, tested where it is
// defined. Its logger is silenced so the failure is not mistaken for the
// handler's.
func newTestAPI(
	db *sql.DB,
	completions *sql.DB,
	queries Querier,
	storageProvider storage.Provider,
	logger *slog.Logger,
	encryptor emailsettings.SecretManager,
	tester internalsmtp.Tester,
) (*API, error) {
	// The client is built from the environment the way the process builds its
	// own, which is what lets newRevalidateRecorder turn it on.
	reval, err := revalidate.NewClient(os.Getenv("PUBLIRA_REVALIDATE_TOKEN"), logger)
	if err != nil {
		return nil, err
	}
	api, err := newAPI(db, queries, storageProvider, logger, encryptor, tester, testutil.TokenManager(), reval, nil, openMailGuard())
	if err != nil {
		return nil, err
	}
	if completions != nil {
		api.server.reval = revalidate.NewRequester(revalidate.RequesterConfig{
			Client:  reval,
			Queries: queries,
			DB:      completions,
			Logger:  slog.New(slog.DiscardHandler),
		})
	}
	return api, nil
}

// openMailGuard allows far more than any case that is not about the mail limit
// reaches, so those cases assert the behaviour they are about rather than the
// limit they happen to sit under. Every one of them shares this process's
// loopback address, which is a single origin as far as the limit is concerned.
func openMailGuard() *mailguard.Guard {
	return mailGuardWith(platformpolicy.HourDay{PerHour: 1000, PerDay: 1000}, platformpolicy.HourDay{PerHour: 1000, PerDay: 1000})
}

// testRevalidateToken is what tells a server built for a test that revalidates
// from one that does not.
const testRevalidateToken = "test-revalidate-token"

// revalidateTargets maps each web app a write is sent to onto the variable
// that points the client at it.
var revalidateTargets = map[string]string{
	"web-host":     "PUBLIRA_WEB_HOST_INTERNAL_URL",
	"web-admin":    "PUBLIRA_WEB_ADMIN_INTERNAL_URL",
	"web-platform": "PUBLIRA_WEB_PLATFORM_INTERNAL_URL",
}

// revalidateRecorder stands in for the Next.js apps and collects the tags the
// handlers ask each of them to drop.
type revalidateRecorder struct {
	mu   sync.Mutex
	tags map[string][]string
}

// requestedTags returns the tags each web app was sent, deduplicated and
// sorted.
func (r *revalidateRecorder) requestedTags() map[string][]string {
	r.mu.Lock()
	defer r.mu.Unlock()
	requested := make(map[string][]string, len(r.tags))
	for app, tags := range r.tags {
		unique := slices.Clone(tags)
		slices.Sort(unique)
		requested[app] = slices.Compact(unique)
	}
	return requested
}

// waitForTags waits until every web app has been sent the tags a write
// recorded. The apps are asked off the request and in parallel, so the first
// one to arrive says nothing of the others still being read.
func (r *revalidateRecorder) waitForTags(t *testing.T, want []string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	var got map[string][]string
	for time.Now().Before(deadline) {
		got = r.requestedTags()
		if everyTargetGot(got, want) {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("revalidated tags = %v, want %v for each of %v", got, want, slices.Sorted(maps.Keys(revalidateTargets)))
}

func everyTargetGot(got map[string][]string, want []string) bool {
	for app := range revalidateTargets {
		if !slices.Equal(got[app], want) {
			return false
		}
	}
	return true
}

// disableRevalidationUnlessRecorded turns revalidation off for every test that
// did not ask for it with [newRevalidateRecorder]. The development environment
// sets PUBLIRA_REVALIDATE_TOKEN, and a server that picked it up would record an
// outbox event no expectation covers — so the same test would pass in CI and
// fail on a developer's machine.
func disableRevalidationUnlessRecorded(t *testing.T) {
	t.Helper()
	if os.Getenv("PUBLIRA_REVALIDATE_TOKEN") != testRevalidateToken {
		t.Setenv("PUBLIRA_REVALIDATE_TOKEN", "")
	}
}

// newRevalidateRecorder points the three revalidate targets at one recording
// server, each under a path of its own so the recorder can tell them apart, and
// configures the token that turns the client on. The handler reads this
// environment when it is built, so call this before newTestAdminServer.
func newRevalidateRecorder(t *testing.T) *revalidateRecorder {
	t.Helper()
	recorder := &revalidateRecorder{tags: map[string][]string{}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		app, _, _ := strings.Cut(strings.TrimPrefix(r.URL.Path, "/"), "/")
		if _, ok := revalidateTargets[app]; !ok {
			t.Errorf("revalidate request to %s, which names no web app", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		var payload struct {
			Tags []string `json:"tags"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Errorf("decode revalidate payload: %v", err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		recorder.mu.Lock()
		recorder.tags[app] = append(recorder.tags[app], payload.Tags...)
		recorder.mu.Unlock()
	}))
	t.Cleanup(server.Close)
	t.Setenv("PUBLIRA_REVALIDATE_TOKEN", testRevalidateToken)
	for app, env := range revalidateTargets {
		t.Setenv(env, server.URL+"/"+app)
	}
	return recorder
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

// recordingStorageProvider keeps every uploaded object, so a test can assert
// on the bytes a handler actually produced rather than only on the fact that
// it uploaded something.
type recordingStorageProvider struct {
	mu      sync.Mutex
	uploads []storage.UploadRequest
}

func (p *recordingStorageProvider) Upload(_ context.Context, req storage.UploadRequest) (storage.UploadResult, error) {
	p.mu.Lock()
	p.uploads = append(p.uploads, req)
	p.mu.Unlock()
	return storage.UploadResult{
		Provider:  "s3",
		ObjectKey: req.ObjectKey,
		URL:       "s3://" + req.ObjectKey,
		SizeBytes: int64(len(req.Data)),
	}, nil
}

// recorded returns the uploads seen so far, in the order they arrived.
func (p *recordingStorageProvider) recorded() []storage.UploadRequest {
	p.mu.Lock()
	defer p.mu.Unlock()
	return slices.Clone(p.uploads)
}

var oneByOnePNG = []byte{
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
	0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
	0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
	0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
	0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
	0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
	0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
	0x42, 0x60, 0x82,
}

var oneByOneJPEG = []byte{
	0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
	0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x60,
	0x00, 0x60, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
	0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
	0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c,
	0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
	0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d,
	0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
	0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
	0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
	0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34,
	0x32, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01,
	0x00, 0x01, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11,
	0x01, 0x03, 0x11, 0x01, 0xff, 0xc4, 0x00, 0x14,
	0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x08,
	0xff, 0xc4, 0x00, 0x14, 0x10, 0x01, 0x00, 0x00,
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	0x00, 0x00, 0x00, 0x00, 0xff, 0xda, 0x00, 0x08,
	0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0xd2, 0xcf,
	0x20, 0xff, 0xd9,
}

func tenantColumns() []string {
	return []string{"id", "public_id", "domain", "name", "created_at", "status", "admin_domain", "timezone", "default_locale"}
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
		WillReturnRows(sqlmock.NewRows(tenantColumns()).
			AddRow(tenantID, publicID, "tenant.example", "Tenant", now, "active", nil, timezone, defaultLocale))
}

// issueTestAdminToken creates a signed JWT for admin API tests.
// tenantID is the tenant primary key (UUID string).
func issueTestAdminToken(tenantID, userPublicID, role string) string {
	token, _, err := testutil.TokenManager().Issue(
		userPublicID,
		auth.AudienceAdmin,
		tenantID,
		role,
		1,
		time.Now(),
	)
	if err != nil {
		panic(err)
	}
	return token
}

func expectActiveSessionLookup(mock sqlmock.Sqlmock, tenantID, userID uuid.UUID, _ string, now time.Time) {
	expectActiveSessionLookupWithRole(mock, tenantID, userID, "", now, auth.RoleTenantEditor)
}

func expectActiveSessionLookupWithRole(mock sqlmock.Sqlmock, tenantID, userID uuid.UUID, _ string, now time.Time, role string) {
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetUserByPublicIDForTenant)).
		WithArgs(uuid.NullUUID{UUID: tenantID, Valid: true}, testUserPublicID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "name", "email", "status", "tenant_id", "created_at"}).
			AddRow(userID, testUserPublicID, "User", "user@example.com", "active", tenantID, now))

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetUserByID)).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "email", "password_hash", "name", "created_at", "status", "tenant_id", "email_verified_at", "credentials_version", "birth_date"}).
			AddRow(userID, testUserPublicID, "user@example.com", "hashed", "User", now, "active", tenantID, nil, int32(1), nil))

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListTenantUserRoles)).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow(role))
}

func assertExpectations(t *testing.T, mock sqlmock.Sqlmock) {
	t.Helper()
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func assertAdminMediaToken(t *testing.T, imageURL string, tenantID, episodeID uuid.UUID, credentialsVersion int32) {
	t.Helper()
	parsed, err := url.Parse(imageURL)
	if err != nil {
		t.Fatalf("image url %q: %v", imageURL, err)
	}
	token := parsed.Query().Get(auth.MediaTokenQueryParam)
	if token == "" {
		t.Fatalf("image url %q has no admin media token", imageURL)
	}
	claims, err := testutil.TokenManager().Verify(token, auth.AudienceAdminMedia)
	if err != nil {
		t.Fatalf("Verify admin media token: %v", err)
	}
	if claims.Subject != testUserPublicID {
		t.Errorf("admin media token subject = %q, want %q", claims.Subject, testUserPublicID)
	}
	if claims.TenantID != tenantID.String() {
		t.Errorf("admin media token tenant = %q, want %q", claims.TenantID, tenantID.String())
	}
	if claims.EpisodeID != episodeID.String() {
		t.Errorf("admin media token episode = %q, want %q", claims.EpisodeID, episodeID.String())
	}
	if claims.CredentialsVersion != credentialsVersion {
		t.Errorf("admin media token credentials version = %d, want %d", claims.CredentialsVersion, credentialsVersion)
	}
	if _, err := testutil.TokenManager().Verify(token, auth.AudienceMedia); err == nil {
		t.Error("admin media token verified as a reader media token")
	}
}

func expectAdminAuditLogInsert(mock sqlmock.Sqlmock) {
	mock.ExpectExec(regexp.QuoteMeta(dbmodels.InsertAuditLog)).
		WillReturnResult(sqlmock.NewResult(0, 1))
}

// expectRevalidationRecord expects the outbox row a write records before the
// tags it owes are sent.
func expectRevalidationRecord(mock sqlmock.Sqlmock, tenantID uuid.UUID) {
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.InsertOutboxEvent)).
		WithArgs(
			sqlmock.AnyArg(),
			uuid.NullUUID{UUID: tenantID, Valid: true},
			outbox.EventTypeNextCacheRevalidation,
			sqlmock.AnyArg(),
			sqlmock.AnyArg(),
			sqlmock.AnyArg(),
		).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "tenant_id", "event_type", "payload", "idempotency_key",
			"status", "attempts", "available_at", "last_error", "created_at", "updated_at", "progress_cursor",
		}).AddRow(
			uuid.Must(uuid.NewV7()),
			uuid.NullUUID{UUID: tenantID, Valid: true},
			outbox.EventTypeNextCacheRevalidation,
			json.RawMessage(`{"tags":[]}`),
			"next_cache_revalidation:"+uuid.Must(uuid.NewV7()).String(),
			"pending", int32(0), time.Now().UTC(), nil, time.Now().UTC(), time.Now().UTC(), nil,
		))
}

// catalogIndexSyncPayload matches the payload of the catalog_index_sync event
// for one row.
type catalogIndexSyncPayload struct {
	kind string
	id   uuid.UUID
}

func (p catalogIndexSyncPayload) Match(value driver.Value) bool {
	raw, ok := value.([]byte)
	if !ok {
		return false
	}
	var payload outbox.CatalogIndexSyncPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return false
	}
	return payload.Kind == p.kind && payload.ID == p.id.String()
}

// expectCatalogIndexSync expects the outbox row a catalog write queues for
// each row whose search document it leaves stale, in the order given.
func expectCatalogIndexSync(mock sqlmock.Sqlmock, tenantID uuid.UUID, kind string, ids ...uuid.UUID) {
	for _, id := range ids {
		mock.ExpectQuery(regexp.QuoteMeta(dbmodels.InsertOutboxEvent)).
			WithArgs(
				sqlmock.AnyArg(),
				uuid.NullUUID{UUID: tenantID, Valid: true},
				outbox.EventTypeCatalogIndexSync,
				catalogIndexSyncPayload{kind: kind, id: id},
				sqlmock.AnyArg(),
				sqlmock.AnyArg(),
			).
			WillReturnRows(sqlmock.NewRows([]string{
				"id", "tenant_id", "event_type", "payload", "idempotency_key",
				"status", "attempts", "available_at", "last_error", "created_at", "updated_at", "progress_cursor",
			}).AddRow(
				uuid.Must(uuid.NewV7()),
				uuid.NullUUID{UUID: tenantID, Valid: true},
				outbox.EventTypeCatalogIndexSync,
				json.RawMessage(`{}`),
				outbox.EventTypeCatalogIndexSync+":"+uuid.Must(uuid.NewV7()).String(),
				"pending", int32(0), time.Now().UTC(), nil, time.Now().UTC(), time.Now().UTC(), nil,
			))
	}
}

func expectPublicIDAttempt(mock sqlmock.Sqlmock) {
	mock.ExpectExec("^SAVEPOINT publira_public_id$").WillReturnResult(sqlmock.NewResult(0, 0))
}

func expectPublicIDAttemptReleased(mock sqlmock.Sqlmock) {
	mock.ExpectExec("^RELEASE SAVEPOINT publira_public_id$").WillReturnResult(sqlmock.NewResult(0, 0))
}

func expectPublicIDAttemptRolledBack(mock sqlmock.Sqlmock) {
	mock.ExpectExec("^ROLLBACK TO SAVEPOINT publira_public_id$").WillReturnResult(sqlmock.NewResult(0, 0))
}

func expectCreateSeriesBaseInsert(mock sqlmock.Sqlmock, seriesID, tenantID uuid.UUID, title, publicID string, now time.Time, labelID uuid.NullUUID) {
	expectPublicIDAttempt(mock)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.CreateSeriesBase)).
		WithArgs(sqlmock.AnyArg(), tenantID, labelID, sqlmock.AnyArg(), title, "all", nil).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "label_id", "public_id", "title", "created_at", "is_published", "published_at", "updated_at", "eye_catch_image_id", "availability", "purchase_availability", "publication_revalidated_at"}).
			AddRow(seriesID, tenantID, labelID, publicID, title, now, false, nil, now, nil, "all", nil, nil))
	expectPublicIDAttemptReleased(mock)
}

func expectLockSeriesByID(mock sqlmock.Sqlmock, tenantID, seriesID uuid.UUID) {
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.LockSeriesByIDForTenant)).
		WithArgs(tenantID, seriesID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id"}).AddRow(seriesID, "SERIES001"))
}

func expectListEpisodesBySeries(mock sqlmock.Sqlmock, tenantID, seriesID uuid.UUID, rows *sqlmock.Rows) {
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListEpisodesBySeriesForTenant)).
		WithArgs(tenantID, seriesID).
		WillReturnRows(rows)
}

func expectUpdateEpisodeOrderIndex(mock sqlmock.Sqlmock, tenantID, seriesID, episodeID uuid.UUID, orderIndex int32) {
	mock.ExpectExec(regexp.QuoteMeta(dbmodels.UpdateEpisodeOrderIndexByIDForTenantAndSeries)).
		WithArgs(orderIndex, tenantID, seriesID, episodeID).
		WillReturnResult(sqlmock.NewResult(0, 1))
}

// testSeriesID and testEpisodeID are what a request names SERIES001 and
// EPISODE001 by, and episodeTestID(n) what it names EP00n by.
var (
	testSeriesID  = uuid.MustParse("01900000-0000-7000-8000-00000000c001")
	testEpisodeID = uuid.MustParse("01900000-0000-7000-8000-00000000c002")
	// testOtherSeriesID and testOtherEpisodeID name nothing the tenant has.
	testOtherSeriesID  = uuid.MustParse("01900000-0000-7000-8000-00000000c003")
	testOtherEpisodeID = uuid.MustParse("01900000-0000-7000-8000-00000000c004")
)

func episodeTestID(n int) uuid.UUID {
	return uuid.MustParse(fmt.Sprintf("01900000-0000-7000-8000-%012d", n))
}

// expectEpisodeSeriesLookup is the read an image upload resolves its episode,
// and the series that episode belongs to, with.
func expectEpisodeSeriesLookup(mock sqlmock.Sqlmock, tenantID, episodeID, seriesID uuid.UUID) {
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetEpisodeSeriesByIDForTenant)).
		WithArgs(tenantID, episodeID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "series_id"}).AddRow(episodeID, "EPISODE001", seriesID))
}

// expectBakeSeriesCreatorsOntoEpisode is the copy that credits a new episode
// with the team its series carries. It runs in the transaction that creates
// the episode, between the listing insert and the commit.
func expectBakeSeriesCreatorsOntoEpisode(mock sqlmock.Sqlmock, tenantID, seriesID, episodeID uuid.UUID) {
	mock.ExpectExec(regexp.QuoteMeta(dbmodels.BakeSeriesCreatorsOntoEpisode)).
		WithArgs(episodeID, tenantID, seriesID).
		WillReturnResult(sqlmock.NewResult(0, 0))
}

// expectResolvedEpisodePurchaseAvailability is the read of where a new episode
// may be bought, resolved through its series and the tenant.
func expectResolvedEpisodePurchaseAvailability(mock sqlmock.Sqlmock, tenantID, episodeID uuid.UUID, resolved string) {
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetResolvedEpisodePurchaseAvailability)).
		WithArgs(tenantID, episodeID).
		WillReturnRows(sqlmock.NewRows([]string{"purchase_availability"}).AddRow(resolved))
}

func expectCreateEpisodeBaseInsert(mock sqlmock.Sqlmock, seriesID, episodeID, tenantID uuid.UUID, title string, orderIndex int32, now time.Time, publicID string) {
	expectPublicIDAttempt(mock)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.CreateEpisodeBase)).
		WithArgs(sqlmock.AnyArg(), seriesID, sqlmock.AnyArg(), title, orderIndex, tenantID, nil, nil).
		WillReturnRows(sqlmock.NewRows([]string{"id", "series_id", "public_id", "title", "order_index", "created_at", "tenant_id", "reading_direction", "spread_start_index", "availability", "purchase_availability"}).
			AddRow(episodeID, seriesID, publicID, title, orderIndex, now, tenantID, nil, nil, nil, nil))
	expectPublicIDAttemptReleased(mock)
}

// mailGuardWith is a mail guard over in-process counters whose mail-request
// limits are the ones given, and whose other values are the built-in defaults.
func mailGuardWith(perAddress, perSource platformpolicy.HourDay) *mailguard.Guard {
	policy := platformpolicy.Defaults()
	policy.MailRequestsPerAddress = perAddress
	policy.MailRequestsPerSource = perSource
	return mailguard.New(ratelimit.New(ratelimit.NewMemoryStore()), platformpolicy.Fixed(policy), slog.Default())
}
