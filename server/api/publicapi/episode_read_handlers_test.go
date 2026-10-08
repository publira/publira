package publicapi

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
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/testutil"
)

type episodeReadFixture struct {
	client   publirav1connect.EpisodeReadServiceClient
	mock     sqlmock.Sqlmock
	tenantID uuid.UUID
	userID   uuid.UUID
	now      time.Time
	// call is the CallInfo of the fixture's latest RPC, which carries the
	// response headers.
	call *connect.CallInfo
}

func newEpisodeReadFixture(t *testing.T) *episodeReadFixture {
	t.Helper()

	testServer, mock := newTestPublicServer(t)
	fixture := &episodeReadFixture{
		client:   publirav1connect.NewEpisodeReadServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL))),
		mock:     mock,
		tenantID: uuid.Must(uuid.NewV7()),
		userID:   uuid.Must(uuid.NewV7()),
		now:      time.Now().UTC().Truncate(time.Microsecond),
	}
	expectTenantLookup(mock, fixture.tenantID, "TENANT", fixture.now)
	expectAuthSession(mock, fixture.tenantID, fixture.userID, fixture.now)
	return fixture
}

func (f *episodeReadFixture) mark(episodeID string) (*publirav1.MarkEpisodeAsReadResponse, error) {
	ctx, call := testutil.NewClientContext(testutil.WithBearer(context.Background(), issueTestPublicToken(f.tenantID.String())))
	f.call = call
	return f.client.MarkEpisodeAsRead(ctx, &publirav1.MarkEpisodeAsReadRequest{
		Tenant:    &publirattypesv1.TenantContext{TenantId: f.tenantID.String()},
		EpisodeId: episodeID,
	})
}

// expectMark stands in for a stored read and the analytics event that follows
// it. The read id is generated in the handler, so it is matched by shape.
func (f *episodeReadFixture) expectMark(episodeID uuid.UUID, readAt time.Time) {
	readID := uuid.Must(uuid.NewV7())
	f.mock.ExpectQuery(regexp.QuoteMeta(dbmodels.MarkPublishedEpisodeAsRead)).
		WithArgs(sqlmock.AnyArg(), f.tenantID, f.userID, episodeID, "web").
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "user_id", "episode_id", "read_at"}).
			AddRow(readID, f.tenantID, f.userID, episodeID, readAt))
	f.mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ProjectEpisodeCompleteEvent)).
		WithArgs(sqlmock.AnyArg(), f.tenantID, f.userID, episodeID).
		WillReturnError(sql.ErrNoRows)
}

func TestMarkEpisodeAsReadStoresTheFirstReadAndReturnsPrivateResponse(t *testing.T) {
	fixture := newEpisodeReadFixture(t)
	episodeID := uuid.Must(uuid.NewV7())
	fixture.expectMark(episodeID, fixture.now)

	response, err := fixture.mark(episodeID.String())
	if err != nil {
		t.Fatalf("MarkEpisodeAsRead: %v", err)
	}
	if got, want := response.ReadAt, fixture.now.Format(time.RFC3339Nano); got != want {
		t.Fatalf("read_at = %q, want %q", got, want)
	}
	if got := fixture.call.ResponseHeader().Get("Cache-Control"); got != "private, no-store" {
		t.Fatalf("Cache-Control = %q, want private, no-store", got)
	}
	assertPublicExpectations(t, fixture.mock)
}

func TestMarkEpisodeAsReadHidesUnavailableEpisodes(t *testing.T) {
	fixture := newEpisodeReadFixture(t)
	unavailable := uuid.Must(uuid.NewV7())
	fixture.mock.ExpectQuery(regexp.QuoteMeta(dbmodels.MarkPublishedEpisodeAsRead)).
		WithArgs(sqlmock.AnyArg(), fixture.tenantID, fixture.userID, unavailable, "web").
		WillReturnError(sql.ErrNoRows)

	_, err := fixture.mark(unavailable.String())
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("MarkEpisodeAsRead error = %v, want not_found", err)
	}
	assertPublicExpectations(t, fixture.mock)
}

func TestMarkEpisodeAsReadRejectsABlankEpisodeID(t *testing.T) {
	fixture := newEpisodeReadFixture(t)

	_, err := fixture.mark("   ")
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("MarkEpisodeAsRead blank ID error = %v, want invalid_argument", err)
	}
	assertPublicExpectations(t, fixture.mock)
}

func TestMarkEpisodeAsReadRequiresASession(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	testServer, mock := newTestPublicServer(t)
	expectTenantLookup(mock, tenantID, "TENANT", time.Now().UTC())
	client := publirav1connect.NewEpisodeReadServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))

	_, err := client.MarkEpisodeAsRead(context.Background(), &publirav1.MarkEpisodeAsReadRequest{
		Tenant:    &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		EpisodeId: uuid.NewString(),
	})
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("MarkEpisodeAsRead without a bearer error = %v, want unauthenticated", err)
	}
	assertPublicExpectations(t, mock)
}
