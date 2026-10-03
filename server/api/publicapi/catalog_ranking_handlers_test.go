package publicapi

import (
	"context"
	"database/sql"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"regexp"
	"slices"
	"strconv"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/pagination"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
)

// rankedSeriesIDRows is what the keyset half of a ranking page returns: the
// series, and the position the snapshot recorded for it.
func rankedSeriesIDRows(rows ...rankedID) *sqlmock.Rows {
	result := sqlmock.NewRows([]string{"id", "rank"})
	for _, row := range rows {
		result.AddRow(row.id, row.rank)
	}
	return result
}

// rankingSnapshotRow is one row of the snapshot pair lookup. period and
// computedAt are what the response reports back as the ranked window, and a
// nil genreID is the tenant-wide ranking.
func rankingSnapshotRow(
	rows *sqlmock.Rows,
	snapshotID, tenantID uuid.UUID,
	genreID any,
	rankingKey string,
	periodStart, periodEnd, computedAt time.Time,
	items []byte,
) *sqlmock.Rows {
	return rows.AddRow(
		snapshotID, tenantID, rankingKey,
		periodStart, periodEnd, "series", items, int32(1), computedAt, genreID, "web", "all",
	)
}

// expectRankingSnapshotPairLookup replays the two snapshots a first page is
// built from: the newest period, and the one the movement markers compare with.
// A nil genreID is the tenant-wide ranking.
func expectRankingSnapshotPairLookup(
	mock sqlmock.Sqlmock,
	tenantID, snapshotID uuid.UUID,
	genreID any,
	rankingKey string,
	computedAt time.Time,
	current, previous []byte,
) {
	rows := rankingSnapshotRow(
		sqlmock.NewRows(contentRankingSnapshotColumns()),
		snapshotID, tenantID, genreID, rankingKey,
		computedAt.AddDate(0, 0, -1), computedAt.AddDate(0, 0, -1), computedAt,
		current,
	)
	if previous != nil {
		rows = rankingSnapshotRow(
			rows,
			uuid.Must(uuid.NewV7()), tenantID, genreID, rankingKey,
			computedAt.AddDate(0, 0, -2), computedAt.AddDate(0, 0, -2), computedAt.AddDate(0, 0, -1),
			previous,
		)
	}
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListLatestContentRankingSnapshots)).
		WithArgs(tenantID, genreID, "web", "all", rankingKey, "series", nil, int32(2)).
		WillReturnRows(rows)
}

// expectPinnedRankingSnapshotLookup replays what a page after the first reads:
// the snapshot its token pinned, then the period before that one. A nil genreID
// is the tenant-wide ranking.
func expectPinnedRankingSnapshotLookup(
	mock sqlmock.Sqlmock,
	tenantID, snapshotID uuid.UUID,
	genreID any,
	rankingKey string,
	computedAt time.Time,
	current, previous []byte,
) {
	periodStart := computedAt.AddDate(0, 0, -1)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetContentRankingSnapshotByID)).
		WithArgs(tenantID, snapshotID, genreID, "web", "all", rankingKey, "series").
		WillReturnRows(rankingSnapshotRow(
			sqlmock.NewRows(contentRankingSnapshotColumns()),
			snapshotID, tenantID, genreID, rankingKey, periodStart, periodStart, computedAt, current,
		))

	rows := sqlmock.NewRows(contentRankingSnapshotColumns())
	if previous != nil {
		rows = rankingSnapshotRow(
			rows,
			uuid.Must(uuid.NewV7()), tenantID, genreID, rankingKey,
			computedAt.AddDate(0, 0, -2), computedAt.AddDate(0, 0, -2), computedAt.AddDate(0, 0, -1),
			previous,
		)
	}
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListLatestContentRankingSnapshots)).
		WithArgs(tenantID, genreID, "web", "all", rankingKey, "series", periodStart, int32(1)).
		WillReturnRows(rows)
}

// assertRankedPositions compares a ranking page against the positions it should
// hold, as "<public id>@<rank>" pairs, so an off-by-one position fails as
// loudly as a missing series.
func assertRankedPositions(t *testing.T, items []*publirav1.RankedSeries, want ...string) {
	t.Helper()

	got := rankedPositions(items)
	if !slices.Equal(got, want) {
		t.Fatalf("ranked series = %v, want %v", got, want)
	}
}

// rankedPositions renders a ranking page as "<public id>@<rank>" pairs.
func rankedPositions(items []*publirav1.RankedSeries) []string {
	positions := make([]string, 0, len(items))
	for _, item := range items {
		positions = append(positions, item.Series.PublicId+"@"+strconv.Itoa(int(item.Rank)))
	}
	return positions
}

func TestCatalogListRankedSeriesReportsSnapshotPositionsAndMovement(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	snapshotID := uuid.Must(uuid.NewV7())
	climbed := uuid.Must(uuid.NewV7())
	slipped := uuid.Must(uuid.NewV7())
	entered := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()

	expectTenantLookup(mock, tenantID, "TENANT", now)
	// The two series that were ranked last time swapped places, and the third
	// is new to the leaderboard.
	expectRankingSnapshotPairLookup(mock, tenantID, snapshotID, nil, "daily", now,
		rankingItemsJSON(climbed, slipped, entered),
		rankingItemsJSON(slipped, climbed),
	)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListRankedSeriesIDs)).
		WithArgs(tenantID, "all", "web", nil, nil, false, nil, int32(4), sqlmock.AnyArg()).
		WillReturnRows(rankedSeriesIDRows(
			rankedID{id: climbed, rank: 1},
			rankedID{id: slipped, rank: 2},
			rankedID{id: entered, rank: 3},
		))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListActiveSeriesByIDs)).
		WithArgs("web", tenantID, sqlmock.AnyArg()).
		WillReturnRows(recommendedSeriesRow(
			recommendedSeriesRow(
				recommendedSeriesRow(seriesDetailColumns(), entered, "ENTERED", "Entered", now),
				slipped, "SLIPPED", "Slipped", now),
			climbed, "CLIMBED", "Climbed", now))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListRankedSeries(context.Background(), connect.NewRequest(&publirav1.ListRankedSeriesRequest{
		Limit:  3,
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}))
	if err != nil {
		t.Fatalf("ListRankedSeries: %v", err)
	}

	assertRankedPositions(t, resp.Msg.RankedSeries, "CLIMBED@1", "SLIPPED@2", "ENTERED@3")
	if got := resp.Msg.RankedSeries[0].GetPreviousRank(); got != 2 {
		t.Fatalf("previous_rank of the climber = %d, want 2", got)
	}
	if got := resp.Msg.RankedSeries[1].GetPreviousRank(); got != 1 {
		t.Fatalf("previous_rank of the slipper = %d, want 1", got)
	}
	// A new entry has no movement to draw. Absent, not zero: position 0 would
	// render as a climb from the top of the chart.
	if resp.Msg.RankedSeries[2].PreviousRank != nil {
		t.Fatalf("previous_rank of the new entry = %d, want absent", resp.Msg.RankedSeries[2].GetPreviousRank())
	}
	if resp.Msg.ComputedAt != now.Format(time.RFC3339) {
		t.Fatalf("computed_at = %q, want %q", resp.Msg.ComputedAt, now.Format(time.RFC3339))
	}
	want := now.AddDate(0, 0, -1).Format(time.DateOnly)
	if resp.Msg.PeriodStart != want || resp.Msg.PeriodEnd != want {
		t.Fatalf("period = %q..%q, want %q on both sides", resp.Msg.PeriodStart, resp.Msg.PeriodEnd, want)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogListRankedSeriesKeepsSnapshotPositionsOverAGap(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	snapshotID := uuid.Must(uuid.NewV7())
	first := uuid.Must(uuid.NewV7())
	unpublished := uuid.Must(uuid.NewV7())
	third := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectRankingSnapshotPairLookup(mock, tenantID, snapshotID, nil, "daily", now,
		rankingItemsJSON(first, unpublished, third), nil)
	// The scan drops the series that was unpublished since the snapshot was
	// written. The positions around it are the snapshot's own and do not close
	// up over the gap.
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListRankedSeriesIDs)).
		WithArgs(tenantID, "all", "web", nil, nil, false, nil, int32(4), sqlmock.AnyArg()).
		WillReturnRows(rankedSeriesIDRows(
			rankedID{id: first, rank: 1},
			rankedID{id: third, rank: 3},
		))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListActiveSeriesByIDs)).
		WithArgs("web", tenantID, sqlmock.AnyArg()).
		WillReturnRows(recommendedSeriesRow(
			recommendedSeriesRow(seriesDetailColumns(), third, "THIRD", "Third", now),
			first, "FIRST", "First", now))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListRankedSeries(context.Background(), connect.NewRequest(&publirav1.ListRankedSeriesRequest{
		Limit:  3,
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}))
	if err != nil {
		t.Fatalf("ListRankedSeries: %v", err)
	}

	assertRankedPositions(t, resp.Msg.RankedSeries, "FIRST@1", "THIRD@3")
	assertPublicExpectations(t, mock)
}

func TestCatalogListRankedSeriesReadsTheWeeklySnapshotForTheWeeklyPeriod(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	snapshotID := uuid.Must(uuid.NewV7())
	seriesID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectRankingSnapshotPairLookup(mock, tenantID, snapshotID, nil, "weekly", now, rankingItemsJSON(seriesID), nil)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListRankedSeriesIDs)).
		WithArgs(tenantID, "all", "web", nil, nil, false, nil, int32(3), sqlmock.AnyArg()).
		WillReturnRows(rankedSeriesIDRows(rankedID{id: seriesID, rank: 1}))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListActiveSeriesByIDs)).
		WithArgs("web", tenantID, sqlmock.AnyArg()).
		WillReturnRows(recommendedSeriesRow(seriesDetailColumns(), seriesID, "WEEKLY", "Weekly", now))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListRankedSeries(context.Background(), connect.NewRequest(&publirav1.ListRankedSeriesRequest{
		Limit:  2,
		Period: publirav1.RankingPeriod_RANKING_PERIOD_WEEKLY,
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}))
	if err != nil {
		t.Fatalf("ListRankedSeries: %v", err)
	}

	assertRankedPositions(t, resp.Msg.RankedSeries, "WEEKLY@1")
	assertPublicExpectations(t, mock)
}

func TestCatalogListRankedSeriesReturnsAnEmptyListWithoutASnapshot(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()

	expectTenantLookup(mock, tenantID, "TENANT", now)
	// The batch has never ranked this tenant. Nothing computed is not a
	// failure, and there is no window to report either.
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListLatestContentRankingSnapshots)).
		WithArgs(tenantID, nil, "web", "all", "daily", "series", nil, int32(2)).
		WillReturnRows(sqlmock.NewRows(contentRankingSnapshotColumns()))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListRankedSeries(context.Background(), connect.NewRequest(&publirav1.ListRankedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}))
	if err != nil {
		t.Fatalf("ListRankedSeries: %v", err)
	}

	if len(resp.Msg.RankedSeries) != 0 {
		t.Fatalf("ranked_series = %+v, want an empty list", resp.Msg.RankedSeries)
	}
	if resp.Msg.ComputedAt != "" || resp.Msg.PeriodStart != "" || resp.Msg.PeriodEnd != "" {
		t.Fatalf("computed_at = %q, period = %q..%q, want all empty without a snapshot",
			resp.Msg.ComputedAt, resp.Msg.PeriodStart, resp.Msg.PeriodEnd)
	}
	if resp.Msg.PreviousToken != "" || resp.Msg.NextToken != "" {
		t.Fatalf("tokens = %q / %q, want both empty without a snapshot", resp.Msg.PreviousToken, resp.Msg.NextToken)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogListRankedSeriesServesTheRankingWhenTheEarlierSnapshotIsMalformed(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	snapshotID := uuid.Must(uuid.NewV7())
	seriesID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()

	expectTenantLookup(mock, tenantID, "TENANT", now)
	// An object where the batch writes an array. The movement markers are lost
	// with it; the positions themselves are correct without them.
	expectRankingSnapshotPairLookup(mock, tenantID, snapshotID, nil, "daily", now,
		rankingItemsJSON(seriesID), []byte(`{"broken":true}`))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListRankedSeriesIDs)).
		WithArgs(tenantID, "all", "web", nil, nil, false, nil, int32(3), sqlmock.AnyArg()).
		WillReturnRows(rankedSeriesIDRows(rankedID{id: seriesID, rank: 1}))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListActiveSeriesByIDs)).
		WithArgs("web", tenantID, sqlmock.AnyArg()).
		WillReturnRows(recommendedSeriesRow(seriesDetailColumns(), seriesID, "RANKED", "Ranked", now))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListRankedSeries(context.Background(), connect.NewRequest(&publirav1.ListRankedSeriesRequest{
		Limit:  2,
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}))
	if err != nil {
		t.Fatalf("ListRankedSeries: %v", err)
	}

	assertRankedPositions(t, resp.Msg.RankedSeries, "RANKED@1")
	if resp.Msg.RankedSeries[0].PreviousRank != nil {
		t.Fatalf("previous_rank = %d, want absent when the earlier snapshot is unreadable",
			resp.Msg.RankedSeries[0].GetPreviousRank())
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogListRankedSeriesRecoversFromAnEmptyPage(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	snapshotID := uuid.Must(uuid.NewV7())
	boundary := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	token := webToken(pagination.Forward, "daily", "all", snapshotID.String(), "1", boundary.String())

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectPinnedRankingSnapshotLookup(mock, tenantID, snapshotID, nil, "daily", now, rankingItemsJSON(boundary), nil)
	// Everything past the boundary was unpublished after the token was issued.
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListRankedSeriesIDs)).
		WithArgs(tenantID, "all", "web", nil, boundary, false, int32(1), int32(3), sqlmock.AnyArg()).
		WillReturnRows(rankedSeriesIDRows())

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListRankedSeries(context.Background(), connect.NewRequest(&publirav1.ListRankedSeriesRequest{
		Limit:  2,
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Token:  token,
	}))
	if err != nil {
		t.Fatalf("ListRankedSeries: %v", err)
	}

	if len(resp.Msg.RankedSeries) != 0 {
		t.Fatalf("ranked_series = %+v, want an empty page", resp.Msg.RankedSeries)
	}
	if resp.Msg.PreviousToken == "" {
		t.Fatalf("previous_token is empty, want a recovery token back to the boundary")
	}
	if resp.Msg.NextToken != "" {
		t.Fatalf("next_token = %q, want empty when nothing follows the boundary", resp.Msg.NextToken)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogListRankedSeriesRejectsATokenFromAnotherPeriod(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	// The same position names a different series in the daily ranking, so a
	// weekly token cannot be reinterpreted against it.
	_, err := client.ListRankedSeries(context.Background(), connect.NewRequest(&publirav1.ListRankedSeriesRequest{
		Period: publirav1.RankingPeriod_RANKING_PERIOD_DAILY,
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Token: webToken(
			pagination.Forward, "weekly", "all", uuid.Must(uuid.NewV7()).String(), "1", uuid.Must(uuid.NewV7()).String()),
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("error code = %v, want InvalidArgument", connect.CodeOf(err))
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogListRankedSeriesRejectsATokenFromAnotherAgeRating(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	// Each rating is a leaderboard of its own, so an r18 position cannot be
	// continued in the all-ages chart. The token is refused before the tenant's
	// age rule is read.
	_, err := client.ListRankedSeries(context.Background(), connect.NewRequest(&publirav1.ListRankedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Token: webToken(
			pagination.Forward, "daily", "r18", uuid.Must(uuid.NewV7()).String(), "1", uuid.Must(uuid.NewV7()).String()),
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("error code = %v, want InvalidArgument", connect.CodeOf(err))
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogListRankedSeriesRejectsAnUnknownAgeRating(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	// A rating from a newer client names a leaderboard this build does not
	// write, and answering with the all-ages one instead would mislabel it.
	_, err := client.ListRankedSeries(context.Background(), connect.NewRequest(&publirav1.ListRankedSeriesRequest{
		Tenant:    &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		AgeRating: publirattypesv1.SeriesAgeRating(99),
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("error code = %v, want InvalidArgument", connect.CodeOf(err))
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogListRankedSeriesRejectsABrokenToken(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.ListRankedSeries(context.Background(), connect.NewRequest(&publirav1.ListRankedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		// Five keys are the right count, but the rank is not a number.
		Token: webToken(
			pagination.Forward, "daily", "all", uuid.Must(uuid.NewV7()).String(), "first", uuid.Must(uuid.NewV7()).String()),
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("error code = %v, want InvalidArgument", connect.CodeOf(err))
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogListRankedSeriesRejectsATokenWhoseRankingIsGone(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	snapshotID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()

	expectTenantLookup(mock, tenantID, "TENANT", now)
	// The retention purge dropped the snapshot the token was built from. Its
	// positions cannot be continued in a newer ranking, so the token is refused
	// and the client starts again at the first page.
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetContentRankingSnapshotByID)).
		WithArgs(tenantID, snapshotID, nil, "web", "all", "daily", "series").
		WillReturnError(sql.ErrNoRows)

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.ListRankedSeries(context.Background(), connect.NewRequest(&publirav1.ListRankedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Token: webToken(
			pagination.Forward, "daily", "all", snapshotID.String(), "1", uuid.Must(uuid.NewV7()).String()),
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("error code = %v, want InvalidArgument", connect.CodeOf(err))
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogListRankedSeriesKeepsALaterPageInThePinnedSnapshot(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	pinned := uuid.Must(uuid.NewV7())
	boundary := uuid.Must(uuid.NewV7())
	tail := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	token := webToken(pagination.Forward, "daily", "all", pinned.String(), "1", boundary.String())

	expectTenantLookup(mock, tenantID, "TENANT", now)
	// The batch wrote a newer ranking while the reader was on page 1. The token
	// names the snapshot page 1 came from, so page 2 continues in that one: a
	// position from the old ranking read against the new ordering would skip or
	// repeat the series around the boundary.
	expectPinnedRankingSnapshotLookup(mock, tenantID, pinned, nil, "daily", now,
		rankingItemsJSON(boundary, tail), rankingItemsJSON(tail, boundary))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListRankedSeriesIDs)).
		WithArgs(tenantID, "all", "web", nil, boundary, false, int32(1), int32(3), rankingItemsJSON(boundary, tail)).
		WillReturnRows(rankedSeriesIDRows(rankedID{id: tail, rank: 2}))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListActiveSeriesByIDs)).
		WithArgs("web", tenantID, sqlmock.AnyArg()).
		WillReturnRows(recommendedSeriesRow(seriesDetailColumns(), tail, "TAIL", "Tail", now))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListRankedSeries(context.Background(), connect.NewRequest(&publirav1.ListRankedSeriesRequest{
		Limit:  2,
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Token:  token,
	}))
	if err != nil {
		t.Fatalf("ListRankedSeries: %v", err)
	}

	assertRankedPositions(t, resp.Msg.RankedSeries, "TAIL@2")
	// The movement marker compares against the period before the pinned one,
	// so it says the same thing page 1 said.
	if got := resp.Msg.RankedSeries[0].GetPreviousRank(); got != 1 {
		t.Fatalf("previous_rank = %d, want 1", got)
	}
	if resp.Msg.ComputedAt != now.Format(time.RFC3339) {
		t.Fatalf("computed_at = %q, want the pinned snapshot's %q", resp.Msg.ComputedAt, now.Format(time.RFC3339))
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogListRankedSeriesRejectsAnotherTenantsRequest(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantByID)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.ListRankedSeries(context.Background(), connect.NewRequest(&publirav1.ListRankedSeriesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("error code = %v, want NotFound", connect.CodeOf(err))
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogListRankedSeriesReadsTheLeaderboardOfTheNamedGenre(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	genreID := uuid.Must(uuid.NewV7())
	snapshotID := uuid.Must(uuid.NewV7())
	climbed := uuid.Must(uuid.NewV7())
	slipped := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()

	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetGenreIDByPublicIDForTenant)).
		WithArgs(tenantID, "GENRE0000001").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(genreID))
	// Both periods, and the scan behind the page, are the genre's: the movement
	// is measured within the genre rather than against the tenant-wide chart.
	expectRankingSnapshotPairLookup(mock, tenantID, snapshotID, genreID, "daily", now,
		rankingItemsJSON(climbed, slipped),
		rankingItemsJSON(slipped, climbed),
	)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListRankedSeriesIDs)).
		WithArgs(tenantID, "all", "web", genreID, nil, false, nil, int32(2), sqlmock.AnyArg()).
		WillReturnRows(rankedSeriesIDRows(
			rankedID{id: climbed, rank: 1},
			rankedID{id: slipped, rank: 2},
		))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListActiveSeriesByIDs)).
		WithArgs("web", tenantID, sqlmock.AnyArg()).
		WillReturnRows(recommendedSeriesRow(
			recommendedSeriesRow(seriesDetailColumns(), slipped, "SLIPPED", "Slipped", now),
			climbed, "CLIMBED", "Climbed", now))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListRankedSeries(context.Background(), connect.NewRequest(&publirav1.ListRankedSeriesRequest{
		GenrePublicId: "GENRE0000001",
		Limit:         1,
		Tenant:        &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}))
	if err != nil {
		t.Fatalf("ListRankedSeries: %v", err)
	}

	assertRankedPositions(t, resp.Msg.RankedSeries, "CLIMBED@1")
	if got := resp.Msg.RankedSeries[0].GetPreviousRank(); got != 2 {
		t.Fatalf("previous_rank = %d, want 2", got)
	}
	// The token names the genre beside the period, so it continues this genre's
	// chart and no other.
	want := webToken(pagination.Forward, "daily+genre:GENRE0000001", "all", snapshotID.String(), "1", climbed.String())
	if resp.Msg.NextToken != want {
		t.Fatalf("next_token = %q, want %q", resp.Msg.NextToken, want)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogListRankedSeriesKeepsALaterGenrePageInThePinnedSnapshot(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	genreID := uuid.Must(uuid.NewV7())
	pinned := uuid.Must(uuid.NewV7())
	boundary := uuid.Must(uuid.NewV7())
	tail := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()

	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetGenreIDByPublicIDForTenant)).
		WithArgs(tenantID, "GENRE0000001").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(genreID))
	// The pinned read is checked against the genre too, so an id lifted from
	// another chart's token finds nothing.
	expectPinnedRankingSnapshotLookup(mock, tenantID, pinned, genreID, "daily", now,
		rankingItemsJSON(boundary, tail), rankingItemsJSON(tail, boundary))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListRankedSeriesIDs)).
		WithArgs(tenantID, "all", "web", genreID, boundary, false, int32(1), int32(3), rankingItemsJSON(boundary, tail)).
		WillReturnRows(rankedSeriesIDRows(rankedID{id: tail, rank: 2}))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListActiveSeriesByIDs)).
		WithArgs("web", tenantID, sqlmock.AnyArg()).
		WillReturnRows(recommendedSeriesRow(seriesDetailColumns(), tail, "TAIL", "Tail", now))

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListRankedSeries(context.Background(), connect.NewRequest(&publirav1.ListRankedSeriesRequest{
		GenrePublicId: "GENRE0000001",
		Limit:         2,
		Tenant:        &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Token:         webToken(pagination.Forward, "daily+genre:GENRE0000001", "all", pinned.String(), "1", boundary.String()),
	}))
	if err != nil {
		t.Fatalf("ListRankedSeries: %v", err)
	}

	assertRankedPositions(t, resp.Msg.RankedSeries, "TAIL@2")
	if got := resp.Msg.RankedSeries[0].GetPreviousRank(); got != 1 {
		t.Fatalf("previous_rank = %d, want 1", got)
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogListRankedSeriesRejectsAGenreTheTenantDoesNotCurate(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()

	expectTenantLookup(mock, tenantID, "TENANT", now)
	// Deleted, never created, or another tenant's: all three are the 404 the
	// genre's series list already answers, never an empty chart.
	expectGenreLookup(mock, tenantID, "GENRE0000404", false)

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	_, err := client.ListRankedSeries(context.Background(), connect.NewRequest(&publirav1.ListRankedSeriesRequest{
		GenrePublicId: "GENRE0000404",
		Tenant:        &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("error code = %v, want NotFound", connect.CodeOf(err))
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogListRankedSeriesRejectsAGenreUnderARatedRanking(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()

	expectTenantLookup(mock, tenantID, "TENANT", now)

	client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
	// The batch ranks a genre's all-ages series alone, so an R18 chart of a
	// genre is refused before anything is read rather than answered empty.
	_, err := client.ListRankedSeries(context.Background(), connect.NewRequest(&publirav1.ListRankedSeriesRequest{
		AgeRating:     publirattypesv1.SeriesAgeRating_SERIES_AGE_RATING_R18,
		GenrePublicId: "GENRE0000001",
		Tenant:        &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("error code = %v, want InvalidArgument", connect.CodeOf(err))
	}
	assertPublicExpectations(t, mock)
}

func TestCatalogListRankedSeriesRejectsATokenFromAnotherGenre(t *testing.T) {
	snapshotID := uuid.Must(uuid.NewV7()).String()
	seriesID := uuid.Must(uuid.NewV7()).String()

	// The same position names a different series in each genre's chart and in
	// the tenant-wide one, so a token crosses none of those lines. Each case is
	// refused before the genre is looked up.
	tests := []struct {
		name     string
		genre    string
		tokenKey string
	}{
		{name: "another genre's token", genre: "GENRE0000001", tokenKey: "daily+genre:GENRE0000002"},
		{name: "a genre's token with no genre", genre: "", tokenKey: "daily+genre:GENRE0000001"},
		{name: "the tenant-wide token with a genre", genre: "GENRE0000001", tokenKey: "daily"},
		{name: "another period of the same genre", genre: "GENRE0000001", tokenKey: "weekly+genre:GENRE0000001"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			testServer, mock := newTestPublicServer(t)

			tenantID := uuid.Must(uuid.NewV7())
			expectTenantLookup(mock, tenantID, "TENANT", time.Now().UTC())

			client := publirav1connect.NewCatalogServiceClient(testServer.Client(), testServer.URL)
			_, err := client.ListRankedSeries(context.Background(), connect.NewRequest(&publirav1.ListRankedSeriesRequest{
				GenrePublicId: tt.genre,
				Tenant:        &publirattypesv1.TenantContext{TenantId: tenantID.String()},
				Token:         webToken(pagination.Forward, tt.tokenKey, "all", snapshotID, "1", seriesID),
			}))
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("error code = %v, want InvalidArgument", connect.CodeOf(err))
			}
			assertPublicExpectations(t, mock)
		})
	}
}
