package publicapi

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"net/http"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
)

// capturedArg matches any bound parameter and remembers it, so a test can
// assert on a value the handler generated rather than one it was handed.
type capturedArg struct {
	value driver.Value
}

func (c *capturedArg) Match(v driver.Value) bool {
	c.value = v
	return true
}

func (c *capturedArg) uuid(t *testing.T) uuid.UUID {
	t.Helper()
	switch v := c.value.(type) {
	case uuid.UUID:
		return v
	case string:
		parsed, err := uuid.Parse(v)
		if err != nil {
			t.Fatalf("bound value %q is not a UUID: %v", v, err)
		}
		return parsed
	case nil:
		return uuid.Nil
	default:
		t.Fatalf("bound value %#v is not a UUID", v)
		return uuid.Nil
	}
}

// contentViewFixture is one reader reporting the episode detail page they
// opened: a published free episode, so nothing here needs a session and the
// only actor left is the anonymous one.
type contentViewFixture struct {
	client    publirav1connect.ContentViewServiceClient
	mock      sqlmock.Sqlmock
	tenantID  uuid.UUID
	seriesID  uuid.UUID
	episodeID uuid.UUID
}

func newContentViewFixture(t *testing.T) *contentViewFixture {
	t.Helper()

	testServer, mock := newTestPublicServer(t)
	fixture := &contentViewFixture{
		client:    publirav1connect.NewContentViewServiceClient(testServer.Client(), testServer.URL),
		mock:      mock,
		tenantID:  uuid.Must(uuid.NewV7()),
		seriesID:  uuid.Must(uuid.NewV7()),
		episodeID: uuid.Must(uuid.NewV7()),
	}

	now := time.Now()
	expectTenantLookup(mock, fixture.tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(getPublishedEpisodeByPublicIDQuery)).
		WithArgs(fixture.tenantID, "EPISODE001").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "public_id", "title", "order_index", "series_id", "price",
			"reading_period_hours", "status", "scheduled_at", "published_at",
			"series_public_id", "series_title",
		}).AddRow(
			fixture.episodeID, "EPISODE001", "Episode Title", int32(1), fixture.seriesID,
			int32(0), int32(24), "published", nil, now.UTC(), "SERIES001", "Series Title",
		))
	return fixture
}

func episodeViewTarget(publicID string) *publirav1.ContentViewTarget {
	return &publirav1.ContentViewTarget{
		Type:     publirav1.ContentViewTargetType_CONTENT_VIEW_TARGET_TYPE_EPISODE,
		PublicId: publicID,
	}
}

func seriesViewTarget(publicID string) *publirav1.ContentViewTarget {
	return &publirav1.ContentViewTarget{
		Type:     publirav1.ContentViewTargetType_CONTENT_VIEW_TARGET_TYPE_SERIES,
		PublicId: publicID,
	}
}

func (f *contentViewFixture) request(t *testing.T, cookie string) *connect.Response[publirav1.RecordContentViewResponse] {
	t.Helper()

	resp, err := f.client.RecordContentView(context.Background(), newContentViewRequest(f.tenantID, cookie))
	if err != nil {
		t.Fatalf("RecordContentView: %v", err)
	}
	return resp
}

func newContentViewRequest(tenantID uuid.UUID, cookie string) *connect.Request[publirav1.RecordContentViewRequest] {
	req := connect.NewRequest(&publirav1.RecordContentViewRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Target: episodeViewTarget("EPISODE001"),
	})
	if cookie != "" {
		req.Header().Set("Cookie", anonymousIDCookieName+"="+cookie)
	}
	return req
}

// mintedAnonymousID reads the identifier the response handed back, and fails
// when the response set no cookie at all.
func mintedAnonymousID(t *testing.T, header http.Header) uuid.UUID {
	t.Helper()

	setCookie := header.Values("Set-Cookie")
	response := http.Response{Header: http.Header{"Set-Cookie": setCookie}}
	for _, cookie := range response.Cookies() {
		if cookie.Name != anonymousIDCookieName {
			continue
		}
		id, err := uuid.Parse(cookie.Value)
		if err != nil {
			t.Fatalf("Set-Cookie %s = %q, want a UUID: %v", anonymousIDCookieName, cookie.Value, err)
		}
		return id
	}
	t.Fatalf("Set-Cookie = %v, want a %s cookie", setCookie, anonymousIDCookieName)
	return uuid.Nil
}

func TestRecordContentViewMintsAnonymousActorOnFirstView(t *testing.T) {
	fixture := newContentViewFixture(t)
	anonymousID := &capturedArg{}
	fixture.mock.ExpectQuery(regexp.QuoteMeta(insertDebouncedEpisodeViewEventQuery)).
		WithArgs(
			sqlmock.AnyArg(), fixture.tenantID, nil, anonymousID,
			fixture.seriesID, fixture.episodeID, sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
		).
		WillReturnRows(sqlmock.NewRows(contentEventColumns()))

	resp := fixture.request(t, "")

	// The minted identifier has to be the one that was just recorded, or the
	// reader's next request would open a second actor for the same person.
	if got, want := anonymousID.uuid(t), mintedAnonymousID(t, resp.Header()); got != want {
		t.Fatalf("recorded anonymous_id = %v, want the minted %v", got, want)
	}
	assertPublicExpectations(t, fixture.mock)
}

func TestRecordContentViewReusesTheAnonymousCookieItWasGiven(t *testing.T) {
	fixture := newContentViewFixture(t)
	existing := uuid.Must(uuid.NewV7())
	fixture.mock.ExpectQuery(regexp.QuoteMeta(insertDebouncedEpisodeViewEventQuery)).
		WithArgs(
			sqlmock.AnyArg(), fixture.tenantID, nil, existing,
			fixture.seriesID, fixture.episodeID, sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
		).
		WillReturnRows(sqlmock.NewRows(contentEventColumns()))

	resp := fixture.request(t, existing.String())

	// Re-issuing the cookie on every view would be harmless but pointless
	// traffic; more importantly it must not replace a working identifier.
	if got := resp.Header().Values("Set-Cookie"); len(got) != 0 {
		t.Fatalf("Set-Cookie = %v, want none when the request already carried one", got)
	}
	assertPublicExpectations(t, fixture.mock)
}

// The series a view is filed under comes from the episode row the server read,
// not from anything the caller sent.
func TestRecordContentViewResolvesTheSeriesFromTheEpisodeRow(t *testing.T) {
	fixture := newContentViewFixture(t)
	seriesID := &capturedArg{}
	fixture.mock.ExpectQuery(regexp.QuoteMeta(insertDebouncedEpisodeViewEventQuery)).
		WithArgs(
			sqlmock.AnyArg(), fixture.tenantID, nil, sqlmock.AnyArg(),
			seriesID, fixture.episodeID, sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
		).
		WillReturnRows(sqlmock.NewRows(contentEventColumns()))

	fixture.request(t, "")

	if got := seriesID.uuid(t); got != fixture.seriesID {
		t.Fatalf("recorded series_id = %v, want the episode's series %v", got, fixture.seriesID)
	}
	assertPublicExpectations(t, fixture.mock)
}

func TestRecordContentViewRecordsASeriesViewForASeriesTarget(t *testing.T) {
	testServer, mock := newTestPublicServer(t)
	tenantID := uuid.Must(uuid.NewV7())
	seriesID := uuid.Must(uuid.NewV7())
	expectTenantLookup(mock, tenantID, "TENANT", time.Now())
	mock.ExpectQuery(regexp.QuoteMeta(getPublishedSeriesIDByPublicIDQuery)).
		WithArgs(tenantID, "SERIES001").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(seriesID))
	mock.ExpectQuery(regexp.QuoteMeta(insertDebouncedSeriesViewEventQuery)).
		WithArgs(
			sqlmock.AnyArg(), tenantID, nil, sqlmock.AnyArg(),
			seriesID, sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
		).
		WillReturnRows(sqlmock.NewRows(contentEventColumns()))

	client := publirav1connect.NewContentViewServiceClient(testServer.Client(), testServer.URL)
	if _, err := client.RecordContentView(context.Background(), connect.NewRequest(&publirav1.RecordContentViewRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Target: seriesViewTarget("SERIES001"),
	})); err != nil {
		t.Fatalf("RecordContentView: %v", err)
	}
	assertPublicExpectations(t, mock)
}

// A bearer this server cannot verify leaves the view anonymous, and an
// anonymous view with nothing to identify it is not recorded. web-host sends
// the cookie or the bearer and never both, and it cannot relay the API's
// Set-Cookie back to the reader, so minting here would open a fresh actor on
// every beacon a stale session sends — the unbounded actor growth this RPC
// exists to stop.
func TestRecordContentViewMintsNoActorForARejectedBearer(t *testing.T) {
	fixture := newContentViewFixture(t)
	// authenticateAccessToken re-reads the tenant before it verifies the token.
	expectTenantLookup(fixture.mock, fixture.tenantID, "TENANT", time.Now())
	recorded := forbidEpisodeViewEventInsert(fixture.mock)

	req := newContentViewRequest(fixture.tenantID, "")
	req.Header().Set("Authorization", "Bearer not-a-token")
	resp, err := fixture.client.RecordContentView(context.Background(), req)
	if err != nil {
		t.Fatalf("RecordContentView: %v", err)
	}

	if recorded.value != nil {
		t.Fatalf("recorded event id = %v, want a rejected bearer to record nothing", recorded.value)
	}
	if got := resp.Header().Values("Set-Cookie"); len(got) != 0 {
		t.Fatalf("Set-Cookie = %v, want no identifier minted for a rejected bearer", got)
	}
	// The registered insert stays deliberately unfulfilled, so the shared
	// expectation assertion does not apply here.
}

// The cookie is still the fallback: a caller that kept one is attributable even
// when the session it also sent is no longer good.
func TestRecordContentViewFallsBackToTheCookieForARejectedBearer(t *testing.T) {
	fixture := newContentViewFixture(t)
	expectTenantLookup(fixture.mock, fixture.tenantID, "TENANT", time.Now())
	existing := uuid.Must(uuid.NewV7())
	fixture.mock.ExpectQuery(regexp.QuoteMeta(insertDebouncedEpisodeViewEventQuery)).
		WithArgs(
			sqlmock.AnyArg(), fixture.tenantID, nil, existing,
			fixture.seriesID, fixture.episodeID, sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
		).
		WillReturnRows(sqlmock.NewRows(contentEventColumns()))

	req := newContentViewRequest(fixture.tenantID, existing.String())
	req.Header().Set("Authorization", "Bearer not-a-token")
	if _, err := fixture.client.RecordContentView(context.Background(), req); err != nil {
		t.Fatalf("RecordContentView: %v", err)
	}
	assertPublicExpectations(t, fixture.mock)
}

func TestRecordContentViewSkipsTheViewEventForAPrefetch(t *testing.T) {
	fixture := newContentViewFixture(t)
	// The insert is registered so the matcher can observe whether it ran:
	// leaving it out would let a recorded prefetch pass as a swallowed error.
	recorded := &capturedArg{}
	fixture.mock.ExpectQuery(regexp.QuoteMeta(insertDebouncedEpisodeViewEventQuery)).
		WithArgs(
			sqlmock.AnyArg(), fixture.tenantID, sqlmock.AnyArg(), recorded,
			fixture.seriesID, fixture.episodeID, sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
		).
		WillReturnRows(sqlmock.NewRows(contentEventColumns()))

	req := newContentViewRequest(fixture.tenantID, "")
	req.Header().Set("Sec-Purpose", "prefetch;prerender")
	resp, err := fixture.client.RecordContentView(context.Background(), req)
	if err != nil {
		t.Fatalf("RecordContentView: %v", err)
	}

	if recorded.value != nil {
		t.Fatalf("recorded anonymous_id = %v, want a prefetch to record nothing", recorded.value)
	}
	// The identifier is still handed over: the navigation that follows the
	// prefetch is the one that counts, and it should already be attributable.
	mintedAnonymousID(t, resp.Header())
	// The registered insert stays deliberately unfulfilled, so the shared
	// expectation assertion does not apply here.
}

func TestRecordContentViewSucceedsWhenTheViewEventCannotBeWritten(t *testing.T) {
	fixture := newContentViewFixture(t)
	fixture.mock.ExpectQuery(regexp.QuoteMeta(insertDebouncedEpisodeViewEventQuery)).
		WillReturnError(errors.New("content_events is unavailable"))

	fixture.request(t, "")

	assertPublicExpectations(t, fixture.mock)
}

// A view is not a way to find out what exists: an unresolvable target fails
// before anything is written, the same way FollowService and RatingService
// answer one.
func TestRecordContentViewRejectsUnknownTarget(t *testing.T) {
	testCases := map[string]struct {
		target *publirav1.ContentViewTarget
		want   connect.Code
	}{
		"missing target":     {target: nil, want: connect.CodeInvalidArgument},
		"blank public id":    {target: seriesViewTarget("   "), want: connect.CodeInvalidArgument},
		"unspecified type":   {target: &publirav1.ContentViewTarget{PublicId: "SERIES001"}, want: connect.CodeInvalidArgument},
		"unpublished series": {target: seriesViewTarget("SERIES404"), want: connect.CodeNotFound},
		"unpublished episode": {
			target: episodeViewTarget("EPISODE404"),
			want:   connect.CodeNotFound,
		},
	}
	for name, testCase := range testCases {
		t.Run(name, func(t *testing.T) {
			testServer, mock := newTestPublicServer(t)
			tenantID := uuid.Must(uuid.NewV7())
			expectTenantLookup(mock, tenantID, "TENANT", time.Now())
			switch testCase.target.GetType() {
			case publirav1.ContentViewTargetType_CONTENT_VIEW_TARGET_TYPE_SERIES:
				if testCase.want == connect.CodeNotFound {
					mock.ExpectQuery(regexp.QuoteMeta(getPublishedSeriesIDByPublicIDQuery)).
						WithArgs(tenantID, "SERIES404").
						WillReturnError(sql.ErrNoRows)
				}
			case publirav1.ContentViewTargetType_CONTENT_VIEW_TARGET_TYPE_EPISODE:
				mock.ExpectQuery(regexp.QuoteMeta(getPublishedEpisodeByPublicIDQuery)).
					WithArgs(tenantID, "EPISODE404").
					WillReturnError(sql.ErrNoRows)
			case publirav1.ContentViewTargetType_CONTENT_VIEW_TARGET_TYPE_UNSPECIFIED:
			}

			client := publirav1connect.NewContentViewServiceClient(testServer.Client(), testServer.URL)
			_, err := client.RecordContentView(context.Background(), connect.NewRequest(&publirav1.RecordContentViewRequest{
				Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
				Target: testCase.target,
			}))
			if connect.CodeOf(err) != testCase.want {
				t.Fatalf("RecordContentView code = %v, want %v (err=%v)", connect.CodeOf(err), testCase.want, err)
			}
			assertPublicExpectations(t, mock)
		})
	}
}

// forbidEpisodeViewEventInsert registers the episode view-event insert as an
// observer of a write that must not happen, rather than as an expectation to
// fulfil.
//
// assertPublicExpectations cannot stand in for this. It reports only
// expectations that went unmet, and a query nobody registered fails inside
// sqlmock — where recordViewEvent logs the error and swallows it, because
// instrumentation must never fail the request it instruments. So an
// unregistered insert would run, be rejected, be swallowed, and leave the test
// green. Registering it means the write has somewhere to land where the test
// can see it.
func forbidEpisodeViewEventInsert(mock sqlmock.Sqlmock) *capturedArg {
	recorded := &capturedArg{}
	mock.ExpectQuery(regexp.QuoteMeta(insertDebouncedEpisodeViewEventQuery)).
		WithArgs(
			recorded, sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
			sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
		).
		WillReturnRows(sqlmock.NewRows(contentEventColumns()))
	return recorded
}

// forbidSeriesViewEventInsert is the series counterpart.
func forbidSeriesViewEventInsert(mock sqlmock.Sqlmock) *capturedArg {
	recorded := &capturedArg{}
	mock.ExpectQuery(regexp.QuoteMeta(insertDebouncedSeriesViewEventQuery)).
		WithArgs(
			recorded, sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
			sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
		).
		WillReturnRows(sqlmock.NewRows(contentEventColumns()))
	return recorded
}

// The detail reads are cached by their callers, so a fill of that cache carries
// no reader at all. Instrumenting them would mint a fresh actor per fill and
// leave a row behind for a page nobody opened. The unmet-expectation
// check is what proves no insert ran.
func TestGetEpisodeDetailRecordsNoViewEvent(t *testing.T) {
	testServer, mock := newTestPublicServer(t)
	tenantID := uuid.Must(uuid.NewV7())
	seriesID := uuid.Must(uuid.NewV7())
	episodeID := uuid.Must(uuid.NewV7())
	now := time.Now()

	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(getPublishedEpisodeByPublicIDQuery)).
		WithArgs(tenantID, "EPISODE001").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "public_id", "title", "order_index", "series_id", "price",
			"reading_period_hours", "status", "scheduled_at", "published_at",
			"series_public_id", "series_title",
		}).AddRow(
			episodeID, "EPISODE001", "Episode Title", int32(1), seriesID,
			int32(0), int32(24), "published", nil, now.UTC(), "SERIES001", "Series Title",
		))
	mock.ExpectQuery(regexp.QuoteMeta(listEpisodeImagesByEpisodeIDQuery)).
		WithArgs(episodeID).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "tenant_id", "episode_id", "display_order", "created_at",
			"content_type", "file_size_bytes", "width", "height",
		}))
	recorded := forbidEpisodeViewEventInsert(mock)

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.GetEpisodeDetail(context.Background(), connect.NewRequest(&publirav1.GetEpisodeDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId: "EPISODE001",
	}))
	if err != nil {
		t.Fatalf("GetEpisodeDetail: %v", err)
	}

	if recorded.value != nil {
		t.Fatalf("recorded event id = %v, want a detail read to record nothing", recorded.value)
	}
	// No actor is minted either: a fill that was handed one would hand it on to
	// whichever reader the cached response is later served to.
	if got := resp.Header().Values("Set-Cookie"); len(got) != 0 {
		t.Fatalf("Set-Cookie = %v, want a cached read to mint no actor", got)
	}
	// The registered insert stays deliberately unfulfilled, so the shared
	// expectation assertion does not apply; the body proves the reads ran.
	if got := resp.Msg.Episode.GetTitle(); got != "Episode Title" {
		t.Fatalf("episode title = %q, want the row the read returned", got)
	}
	if resp.Msg.Access != publirav1.EpisodeAccess_EPISODE_ACCESS_FREE {
		t.Fatalf("access = %v, want the free body to be served", resp.Msg.Access)
	}
}

func TestGetSeriesDetailRecordsNoViewEvent(t *testing.T) {
	testServer, mock := newTestPublicServer(t)
	tenantID := uuid.Must(uuid.NewV7())
	seriesID := uuid.Must(uuid.NewV7())
	now := time.Now()

	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(getSeriesDetailQuery)).
		WithArgs("SERIES001", tenantID).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "public_id", "title", "label_public_id", "label_name",
			"eye_catch_image_id", "eye_catch_image_updated_at", "synopsis",
			"is_published", "published_at", "creators", "episodes",
		}).AddRow(
			seriesID, "SERIES001", "Series Title", nil, nil, nil, nil,
			"Synopsis", true, now.UTC(), []byte(`[]`), []byte(`[]`),
		))
	recorded := forbidSeriesViewEventInsert(mock)

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.GetSeriesDetail(context.Background(), connect.NewRequest(&publirav1.GetSeriesDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId: "SERIES001",
	}))
	if err != nil {
		t.Fatalf("GetSeriesDetail: %v", err)
	}

	if recorded.value != nil {
		t.Fatalf("recorded event id = %v, want a detail read to record nothing", recorded.value)
	}
	if got := resp.Header().Values("Set-Cookie"); len(got) != 0 {
		t.Fatalf("Set-Cookie = %v, want a cached read to mint no actor", got)
	}
	if got := resp.Msg.Series.GetTitle(); got != "Series Title" {
		t.Fatalf("series title = %q, want the row the read returned", got)
	}
}
