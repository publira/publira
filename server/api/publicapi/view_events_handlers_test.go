package publicapi

import (
	"context"
	"database/sql/driver"
	"errors"
	"net/http"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/gen/publira/v1/publirav1connect"
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

// episodeViewFixture is the successful GetEpisodeDetail every test below
// instruments: one published free episode, so the read needs no session and the
// only actor left is the anonymous one.
type episodeViewFixture struct {
	client    publirav1connect.CatalogServiceClient
	mock      sqlmock.Sqlmock
	tenantID  uuid.UUID
	seriesID  uuid.UUID
	episodeID uuid.UUID
}

func newEpisodeViewFixture(t *testing.T) *episodeViewFixture {
	t.Helper()

	testServer, mock := newTestPublicServer(t)
	fixture := &episodeViewFixture{
		client:    publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL),
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
	mock.ExpectQuery(regexp.QuoteMeta(listEpisodeImagesByEpisodeIDQuery)).
		WithArgs(fixture.episodeID).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "tenant_id", "episode_id", "display_order", "created_at",
			"content_type", "file_size_bytes", "width", "height",
		}))
	return fixture
}

func (f *episodeViewFixture) request(t *testing.T, cookie string) *connect.Response[publirav1.GetEpisodeDetailResponse] {
	t.Helper()

	req := connect.NewRequest(&publirav1.GetEpisodeDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: f.tenantID.String()},
		PublicId: "EPISODE001",
	})
	if cookie != "" {
		req.Header().Set("Cookie", anonymousIDCookieName+"="+cookie)
	}
	resp, err := f.client.GetEpisodeDetail(context.Background(), req)
	if err != nil {
		t.Fatalf("GetEpisodeDetail: %v", err)
	}
	return resp
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

func TestGetEpisodeDetailMintsAnonymousActorOnFirstRead(t *testing.T) {
	fixture := newEpisodeViewFixture(t)
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

func TestGetEpisodeDetailReusesTheAnonymousCookieItWasGiven(t *testing.T) {
	fixture := newEpisodeViewFixture(t)
	existing := uuid.Must(uuid.NewV7())
	fixture.mock.ExpectQuery(regexp.QuoteMeta(insertDebouncedEpisodeViewEventQuery)).
		WithArgs(
			sqlmock.AnyArg(), fixture.tenantID, nil, existing,
			fixture.seriesID, fixture.episodeID, sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
		).
		WillReturnRows(sqlmock.NewRows(contentEventColumns()))

	resp := fixture.request(t, existing.String())

	// Re-issuing the cookie on every read would be harmless but pointless
	// traffic; more importantly it must not replace a working identifier.
	if got := resp.Header().Values("Set-Cookie"); len(got) != 0 {
		t.Fatalf("Set-Cookie = %v, want none when the request already carried one", got)
	}
	assertPublicExpectations(t, fixture.mock)
}

func TestGetEpisodeDetailSkipsTheViewEventForAPrefetch(t *testing.T) {
	fixture := newEpisodeViewFixture(t)
	// The insert is registered so the matcher can observe whether it ran:
	// leaving it out would let a recorded prefetch pass as a swallowed error.
	recorded := &capturedArg{}
	fixture.mock.ExpectQuery(regexp.QuoteMeta(insertDebouncedEpisodeViewEventQuery)).
		WithArgs(
			sqlmock.AnyArg(), fixture.tenantID, sqlmock.AnyArg(), recorded,
			fixture.seriesID, fixture.episodeID, sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
		).
		WillReturnRows(sqlmock.NewRows(contentEventColumns()))

	req := connect.NewRequest(&publirav1.GetEpisodeDetailRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: fixture.tenantID.String()},
		PublicId: "EPISODE001",
	})
	req.Header().Set("Sec-Purpose", "prefetch;prerender")
	resp, err := fixture.client.GetEpisodeDetail(context.Background(), req)
	if err != nil {
		t.Fatalf("GetEpisodeDetail: %v", err)
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

func TestGetEpisodeDetailSucceedsWhenTheViewEventCannotBeWritten(t *testing.T) {
	fixture := newEpisodeViewFixture(t)
	fixture.mock.ExpectQuery(regexp.QuoteMeta(insertDebouncedEpisodeViewEventQuery)).
		WillReturnError(errors.New("content_events is unavailable"))

	resp := fixture.request(t, "")

	if resp.Msg.Access != publirav1.EpisodeAccess_EPISODE_ACCESS_FREE {
		t.Fatalf("access = %v, want the free body to be served anyway", resp.Msg.Access)
	}
	assertPublicExpectations(t, fixture.mock)
}
