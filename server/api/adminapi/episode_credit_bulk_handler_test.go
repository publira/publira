package adminapi

import (
	"context"
	"fmt"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
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
	seriesID := testSeriesID
	predecessorID := uuid.Must(uuid.NewV7())
	successorID := uuid.Must(uuid.NewV7())
	roleID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	const episodeCount = 800
	episodeIDs := make([]string, 0, episodeCount)
	lockedEpisodes := sqlmock.NewRows([]string{"id", "public_id"})
	replacedEpisodes := sqlmock.NewRows([]string{"episode_id"})
	for index := range episodeCount {
		publicID := fmt.Sprintf("EP%09d", index)
		episodeID := uuid.Must(uuid.NewV7())
		episodeIDs = append(episodeIDs, episodeID.String())
		lockedEpisodes.AddRow(episodeID, publicID)
		replacedEpisodes.AddRow(episodeID)
	}

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListCreatorsByIDsForTenant)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "public_id", "name", "profile_text", "created_at"}).
			AddRow(predecessorID, tenantID, "CREATOR001", "Ren Takahashi", nil, now).
			AddRow(successorID, tenantID, "CREATOR002", "Hana Kubo", nil, now))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListCreatorRolesByIDsForTenant)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "name", "display_priority"}).
			AddRow(roleID, "ROLE00000001", "Artist", int32(2)))
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.LockSeriesByIDForTenant)).
		WithArgs(tenantID, seriesID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id"}).AddRow(seriesID, "SERIES000001"))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.LockEpisodesByIDsForTenantAndSeries)).
		WillReturnRows(lockedEpisodes)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListEpisodesHoldingBothEpisodeCredits)).
		WillReturnRows(sqlmock.NewRows([]string{"episode_id"}))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.BulkReplaceEpisodeCreator)).
		WillReturnRows(replacedEpisodes)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListEpisodesCreditedOnTheEpisodeItself)).
		WillReturnRows(sqlmock.NewRows([]string{"episode_id"}))
	mock.ExpectCommit()
	mock.ExpectExec(regexp.QuoteMeta(dbmodels.InsertAuditLog)).
		WillReturnResult(sqlmock.NewResult(0, 1))

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.BulkEditEpisodeCreditsRequest{
		Tenant:     &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		SeriesId:   testSeriesID.String(),
		EpisodeIds: episodeIDs,
		Operation: &publiraadminv1.BulkEditEpisodeCreditsRequest_Replace{
			Replace: &publiraadminv1.ReplaceEpisodeCreditOperation{
				From: &publiraadminv1.EpisodeCreatorCredit{CreatorId: predecessorID.String(), RoleId: roleID.String()},
				To:   &publiraadminv1.EpisodeCreatorCredit{CreatorId: successorID.String(), RoleId: roleID.String()},
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
		Tenant:     &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		SeriesId:   testSeriesID.String(),
		EpisodeIds: []string{episodeTestID(1).String()},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	_, err := client.BulkEditEpisodeCredits(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("BulkEditEpisodeCredits: err = %v, want invalid_argument", err)
	}
	assertExpectations(t, mock)
}

func TestBulkEditEpisodeCreditsRefusesAShareThatWouldExceedAnEpisodeTotal(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	seriesID := testSeriesID
	episodeID := uuid.Must(uuid.NewV7())
	creatorID := uuid.Must(uuid.NewV7())
	roleID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListCreatorsByIDsForTenant)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "public_id", "name", "profile_text", "created_at"}).
			AddRow(creatorID, tenantID, "CREATOR001", "Ren Takahashi", nil, now))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListCreatorRolesByIDsForTenant)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "name", "display_priority"}).
			AddRow(roleID, "ROLE00000001", "Artist", int32(2)))
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.LockSeriesByIDForTenant)).
		WithArgs(tenantID, seriesID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id"}).AddRow(seriesID, "SERIES000001"))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.LockEpisodesByIDsForTenantAndSeries)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id"}).AddRow(episodeID, "EP000000001"))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListEpisodesExceedingShareAfterBulkSet)).
		WithArgs(tenantID, sqlmock.AnyArg(), creatorID, roleID, int32(6000)).
		WillReturnRows(sqlmock.NewRows([]string{"episode_id"}).AddRow(episodeID))
	mock.ExpectRollback()

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.BulkEditEpisodeCreditsRequest{
		Tenant:     &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		SeriesId:   testSeriesID.String(),
		EpisodeIds: []string{episodeTestID(1).String()},
		Operation: &publiraadminv1.BulkEditEpisodeCreditsRequest_SetShare{
			SetShare: &publiraadminv1.SetEpisodeCreditShareOperation{
				Credit: &publiraadminv1.EpisodeCreatorCredit{CreatorId: creatorID.String(), RoleId: roleID.String(), ShareBps: 6000},
			},
		},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	_, err := client.BulkEditEpisodeCredits(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("BulkEditEpisodeCredits code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
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
		Tenant:     &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		SeriesId:   testSeriesID.String(),
		EpisodeIds: []string{episodeTestID(1).String(), episodeTestID(1).String()},
		Operation: &publiraadminv1.BulkEditEpisodeCreditsRequest_Remove{
			Remove: &publiraadminv1.RemoveEpisodeCreditOperation{
				Credit: &publiraadminv1.EpisodeCreatorCredit{CreatorId: uuid.Must(uuid.NewV7()).String(), RoleId: uuid.Must(uuid.NewV7()).String()},
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
	episodeIDs := make([]string, 0, episodeCount)
	for range episodeCount {
		episodeIDs = append(episodeIDs, uuid.Must(uuid.NewV7()).String())
	}

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)

	client := publiraadminv1connect.NewAdminSeriesServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.BulkEditEpisodeCreditsRequest{
		Tenant:     &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		SeriesId:   testSeriesID.String(),
		EpisodeIds: episodeIDs,
		Operation: &publiraadminv1.BulkEditEpisodeCreditsRequest_Remove{
			Remove: &publiraadminv1.RemoveEpisodeCreditOperation{
				Credit: &publiraadminv1.EpisodeCreatorCredit{CreatorId: uuid.Must(uuid.NewV7()).String(), RoleId: uuid.Must(uuid.NewV7()).String()},
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
