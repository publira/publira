package adminapi

import (
	"context"
	"fmt"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

// A series split into weekly quarter-chapters reaches hundreds of episodes, so
// the range edit has to be one statement rather than one per episode. sqlmock
// is ordered and fails on a statement it was not told to expect, so the single
// UPDATE expected below is that guarantee: a loop over the range would run the
// second one and fail here.
func TestBulkEditEpisodeCreditsWritesTheWholeRangeInOneStatement(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	seriesID := uuid.Must(uuid.NewV7())
	predecessorID := uuid.Must(uuid.NewV7())
	successorID := uuid.Must(uuid.NewV7())
	roleID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	const episodeCount = 800
	episodePublicIDs := make([]string, 0, episodeCount)
	lockedEpisodes := sqlmock.NewRows([]string{"id", "public_id"})
	replacedEpisodes := sqlmock.NewRows([]string{"episode_id"})
	for index := range episodeCount {
		publicID := fmt.Sprintf("EP%09d", index)
		episodeID := uuid.Must(uuid.NewV7())
		episodePublicIDs = append(episodePublicIDs, publicID)
		lockedEpisodes.AddRow(episodeID, publicID)
		replacedEpisodes.AddRow(episodeID)
	}

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	mock.ExpectQuery(regexp.QuoteMeta(listCreatorsByPublicIDsForTenantQuery)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "public_id", "name", "profile_text", "created_at"}).
			AddRow(predecessorID, tenantID, "CREATOR001", "Ren Takahashi", nil, now).
			AddRow(successorID, tenantID, "CREATOR002", "Hana Kubo", nil, now))
	mock.ExpectQuery(regexp.QuoteMeta(listCreatorRolesByPublicIDsForTenantQuery)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "name", "display_priority"}).
			AddRow(roleID, "ROLE00000001", "Artist", int32(2)))
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(lockSeriesByPublicIDForTenantQuery)).
		WithArgs(tenantID, "SERIES000001").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(seriesID))
	mock.ExpectQuery(regexp.QuoteMeta(lockEpisodesByPublicIDsForTenantAndSeriesQuery)).
		WillReturnRows(lockedEpisodes)
	mock.ExpectQuery(regexp.QuoteMeta(listEpisodesHoldingBothEpisodeCreditsQuery)).
		WillReturnRows(sqlmock.NewRows([]string{"episode_id"}))
	mock.ExpectQuery(regexp.QuoteMeta(bulkReplaceEpisodeCreatorQuery)).
		WillReturnRows(replacedEpisodes)
	mock.ExpectQuery(regexp.QuoteMeta(listEpisodesCreditedOnTheEpisodeItselfQuery)).
		WillReturnRows(sqlmock.NewRows([]string{"episode_id"}))
	mock.ExpectCommit()
	mock.ExpectExec("INSERT INTO audit_logs").
		WillReturnResult(sqlmock.NewResult(0, 1))

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.BulkEditEpisodeCreditsRequest{
		Tenant:           &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		SeriesPublicId:   "SERIES000001",
		EpisodePublicIds: episodePublicIDs,
		Operation: &publiraadminv1.BulkEditEpisodeCreditsRequest_Replace{
			Replace: &publiraadminv1.ReplaceEpisodeCreditOperation{
				From: &publiraadminv1.EpisodeCreatorCredit{CreatorPublicId: "CREATOR001", RolePublicId: "ROLE00000001"},
				To:   &publiraadminv1.EpisodeCreatorCredit{CreatorPublicId: "CREATOR002", RolePublicId: "ROLE00000001"},
			},
		},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	resp, err := client.BulkEditEpisodeCredits(context.Background(), req)
	if err != nil {
		t.Fatalf("BulkEditEpisodeCredits: %v", err)
	}
	if len(resp.Msg.ChangedEpisodePublicIds) != episodeCount {
		t.Fatalf("changed = %d episodes, want all %d", len(resp.Msg.ChangedEpisodePublicIds), episodeCount)
	}
	if len(resp.Msg.UnchangedEpisodes) != 0 {
		t.Fatalf("unchanged = %v, want none", resp.Msg.UnchangedEpisodes)
	}
	assertExpectations(t, mock)
}

// A request carrying no operation is answered before anything is read: there
// is nothing to resolve and nothing to write, and sqlmock fails on any
// statement, so the expectations below being empty is the assertion.
func TestBulkEditEpisodeCreditsRefusesARequestWithNoOperation(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.BulkEditEpisodeCreditsRequest{
		Tenant:           &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		SeriesPublicId:   "SERIES000001",
		EpisodePublicIds: []string{"EP000000001"},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	_, err := client.BulkEditEpisodeCredits(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("BulkEditEpisodeCredits: err = %v, want invalid_argument", err)
	}
	assertExpectations(t, mock)
}

// The range is a set of episodes, each named once. A repeated public_id is
// refused before the transaction, because the response would otherwise report
// the same episode twice for one row the statement wrote.
func TestBulkEditEpisodeCreditsRefusesARepeatedEpisode(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.BulkEditEpisodeCreditsRequest{
		Tenant:           &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		SeriesPublicId:   "SERIES000001",
		EpisodePublicIds: []string{"EP000000001", "EP000000001"},
		Operation: &publiraadminv1.BulkEditEpisodeCreditsRequest_Remove{
			Remove: &publiraadminv1.RemoveEpisodeCreditOperation{
				Credit: &publiraadminv1.EpisodeCreatorCredit{CreatorPublicId: "CREATOR001", RolePublicId: "ROLE00000001"},
			},
		},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	_, err := client.BulkEditEpisodeCredits(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("BulkEditEpisodeCredits: err = %v, want invalid_argument", err)
	}
	assertExpectations(t, mock)
}

// Every episode the range names stays locked until the operation commits, so
// the range is bounded. A longer one is refused before the credits are
// resolved and before the transaction begins, which is why the expectations
// below stop at the session lookup.
func TestBulkEditEpisodeCreditsRefusesARangePastTheMaximum(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	const episodeCount = maxBulkEpisodeCreditEpisodes + 1
	episodePublicIDs := make([]string, 0, episodeCount)
	for index := range episodeCount {
		episodePublicIDs = append(episodePublicIDs, fmt.Sprintf("EP%09d", index))
	}

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.BulkEditEpisodeCreditsRequest{
		Tenant:           &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		SeriesPublicId:   "SERIES000001",
		EpisodePublicIds: episodePublicIDs,
		Operation: &publiraadminv1.BulkEditEpisodeCreditsRequest_Remove{
			Remove: &publiraadminv1.RemoveEpisodeCreditOperation{
				Credit: &publiraadminv1.EpisodeCreatorCredit{CreatorPublicId: "CREATOR001", RolePublicId: "ROLE00000001"},
			},
		},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	_, err := client.BulkEditEpisodeCredits(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("BulkEditEpisodeCredits: err = %v, want invalid_argument", err)
	}
	assertExpectations(t, mock)
}
