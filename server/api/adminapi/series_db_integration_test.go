package adminapi

import (
	"context"
	"slices"
	"testing"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// seedTwoTenants returns two tenants that share a server, so the second one
// stands in for "somebody else's data" in isolation checks.
func seedTwoTenants(t *testing.T, env *adminDBEnv) (adminDBTenant, adminDBTenant) {
	t.Helper()

	first := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	second := env.seedTenantWithAdmin(t, "TENANTB", "tenant-b.example.com", "Tenant B", "TBUSER01", "admin@tenant-b.example.com")
	return first, second
}

func TestDBCreateSeriesPersistsAndReadsBack(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()

	created, err := client.CreateSeries(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateSeriesRequest{
		Tenant:             tenant.tenantContext(),
		Title:              "Integration Series",
		Synopsis:           "A series stored in a real database",
		ReadingPeriodHours: 72,
		IsPublished:        true,
	})
	if err != nil {
		t.Fatalf("CreateSeries: %v", err)
	}
	series := created.Series
	if series == nil {
		t.Fatal("CreateSeries returned nil series")
	}
	if series.PublicId == "" {
		t.Fatal("series.public_id is empty")
	}
	if series.Title != "Integration Series" {
		t.Fatalf("series.title = %q, want Integration Series", series.Title)
	}
	if series.Synopsis != "A series stored in a real database" {
		t.Fatalf("series.synopsis = %q", series.Synopsis)
	}
	if series.ReadingPeriodHours != 72 {
		t.Fatalf("series.reading_period_hours = %d, want 72", series.ReadingPeriodHours)
	}
	if !series.IsPublished {
		t.Fatal("series.is_published = false, want true")
	}
	if series.PublishedAt == "" {
		t.Fatal("series.published_at is empty for a published series")
	}

	got, err := client.GetSeries(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.GetSeriesRequest{
		Tenant:   tenant.tenantContext(),
		PublicId: series.PublicId,
	})
	if err != nil {
		t.Fatalf("GetSeries: %v", err)
	}
	if got.Series.Title != series.Title || got.Series.Synopsis != series.Synopsis {
		t.Fatalf("GetSeries = %+v, want title/synopsis of %+v", got.Series, series)
	}

	listed, err := client.ListSeries(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.ListSeriesRequest{
		Tenant: tenant.tenantContext(),
	})
	if err != nil {
		t.Fatalf("ListSeries: %v", err)
	}
	if len(listed.Series) != 1 || listed.Series[0].PublicId != series.PublicId {
		t.Fatalf("ListSeries = %v, want the single created series %s", seriesPublicIDs(listed.Series), series.PublicId)
	}

	// The row must carry the tenant, which is also what RLS filters on.
	if count := env.countRows(t,
		"SELECT count(*) FROM series WHERE public_id = $1 AND tenant_id = $2",
		series.PublicId, tenant.Tenant.ID,
	); count != 1 {
		t.Fatalf("series rows for tenant = %d, want 1", count)
	}
}

func TestDBUpdateSeriesPersistsChanges(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()

	created, err := client.CreateSeries(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateSeriesRequest{
		Tenant:   tenant.tenantContext(),
		Title:    "Draft Title",
		Synopsis: "Draft synopsis",
	})
	if err != nil {
		t.Fatalf("CreateSeries: %v", err)
	}
	publicID := created.Series.PublicId
	if created.Series.IsPublished {
		t.Fatal("series.is_published = true, want an unpublished draft")
	}

	updated, err := client.UpdateSeries(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.UpdateSeriesRequest{
		Tenant:             tenant.tenantContext(),
		SeriesId:           env.seriesID(t, publicID),
		Title:              "Published Title",
		Synopsis:           new("Published synopsis"),
		ReadingPeriodHours: new(int32(24)),
		IsPublished:        true,
	})
	if err != nil {
		t.Fatalf("UpdateSeries: %v", err)
	}
	if updated.Series.Title != "Published Title" {
		t.Fatalf("updated title = %q, want Published Title", updated.Series.Title)
	}

	got, err := client.GetSeries(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.GetSeriesRequest{
		Tenant:   tenant.tenantContext(),
		PublicId: publicID,
	})
	if err != nil {
		t.Fatalf("GetSeries after update: %v", err)
	}
	if got.Series.Title != "Published Title" {
		t.Fatalf("reloaded title = %q, want Published Title", got.Series.Title)
	}
	if got.Series.Synopsis != "Published synopsis" {
		t.Fatalf("reloaded synopsis = %q, want Published synopsis", got.Series.Synopsis)
	}
	if got.Series.ReadingPeriodHours != 24 {
		t.Fatalf("reloaded reading_period_hours = %d, want 24", got.Series.ReadingPeriodHours)
	}
	if !got.Series.IsPublished || got.Series.PublishedAt == "" {
		t.Fatalf("reloaded publication = (%v, %q), want published with a timestamp", got.Series.IsPublished, got.Series.PublishedAt)
	}
}

// The three listing fields survive a real write and read: the schedule is
// stored ascending and distinct whatever order it arrived in, and an update
// that states it replaces the whole set rather than merging into it.
func TestDBSeriesListingMetadataRoundTrips(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()

	created, err := client.CreateSeries(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateSeriesRequest{
		Tenant:           tenant.tenantContext(),
		Title:            "Weekly Story",
		IsPublished:      true,
		Status:           publirattypesv1.SeriesStatus_SERIES_STATUS_ONGOING,
		ScheduleWeekdays: []int32{5, 2, 5},
		AgeRating:        publirattypesv1.SeriesAgeRating_SERIES_AGE_RATING_R15,
	})
	if err != nil {
		t.Fatalf("CreateSeries: %v", err)
	}
	publicID := created.Series.PublicId
	if want := []int32{2, 5}; !slices.Equal(created.Series.ScheduleWeekdays, want) {
		t.Fatalf("created schedule_weekdays = %v, want %v", created.Series.ScheduleWeekdays, want)
	}
	if created.Series.AgeRating != publirattypesv1.SeriesAgeRating_SERIES_AGE_RATING_R15 {
		t.Fatalf("created age_rating = %s, want R15", created.Series.AgeRating)
	}

	listed, err := client.ListSeries(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.ListSeriesRequest{
		Tenant: tenant.tenantContext(),
	})
	if err != nil {
		t.Fatalf("ListSeries: %v", err)
	}
	if len(listed.Series) != 1 {
		t.Fatalf("ListSeries returned %d series, want 1", len(listed.Series))
	}
	if want := []int32{2, 5}; !slices.Equal(listed.Series[0].ScheduleWeekdays, want) {
		t.Fatalf("listed schedule_weekdays = %v, want %v", listed.Series[0].ScheduleWeekdays, want)
	}

	if _, err := client.UpdateSeries(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.UpdateSeriesRequest{
		Tenant:         tenant.tenantContext(),
		SeriesId:       env.seriesID(t, publicID),
		Title:          "Weekly Story",
		IsPublished:    true,
		Status:         publirattypesv1.SeriesStatus_SERIES_STATUS_COMPLETED.Enum(),
		WeeklySchedule: &publiraadminv1.SeriesScheduleWeekdays{},
		AgeRating:      publirattypesv1.SeriesAgeRating_SERIES_AGE_RATING_ALL.Enum(),
	}); err != nil {
		t.Fatalf("UpdateSeries: %v", err)
	}

	got, err := client.GetSeries(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.GetSeriesRequest{
		Tenant:   tenant.tenantContext(),
		PublicId: publicID,
	})
	if err != nil {
		t.Fatalf("GetSeries: %v", err)
	}
	if got.Series.Status != publirattypesv1.SeriesStatus_SERIES_STATUS_COMPLETED {
		t.Fatalf("reloaded status = %s, want COMPLETED", got.Series.Status)
	}
	if got.Series.AgeRating != publirattypesv1.SeriesAgeRating_SERIES_AGE_RATING_ALL {
		t.Fatalf("reloaded age_rating = %s, want ALL", got.Series.AgeRating)
	}
	if len(got.Series.ScheduleWeekdays) != 0 {
		t.Fatalf("reloaded schedule_weekdays = %v, want the empty schedule the update stated", got.Series.ScheduleWeekdays)
	}
}

// Unspecified is the series following its tenant, and it has to be storable
// both ways round, because a series that overrode the tenant must be able to
// go back.
func TestDBSeriesCommentModeOverrideRoundTrips(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTC", "tenant-c.example.com", "Tenant C", "TCUSER01", "admin@tenant-c.example.com")
	client := env.seriesClient()

	created, err := client.CreateSeries(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateSeriesRequest{
		Tenant:      tenant.tenantContext(),
		Title:       "Quiet Story",
		IsPublished: true,
	})
	if err != nil {
		t.Fatalf("CreateSeries: %v", err)
	}
	publicID := created.Series.PublicId
	if created.CommentMode != publirattypesv1.CommentMode_COMMENT_MODE_UNSPECIFIED {
		t.Fatalf("created comment_mode = %s, want UNSPECIFIED so a new series follows its tenant", created.CommentMode)
	}

	updated, err := client.UpdateSeries(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.UpdateSeriesRequest{
		Tenant:      tenant.tenantContext(),
		SeriesId:    env.seriesID(t, publicID),
		Title:       "Quiet Story",
		IsPublished: true,
		CommentMode: publirattypesv1.CommentMode_COMMENT_MODE_DISABLED.Enum(),
	})
	if err != nil {
		t.Fatalf("UpdateSeries: %v", err)
	}
	if updated.CommentMode != publirattypesv1.CommentMode_COMMENT_MODE_DISABLED {
		t.Fatalf("updated comment_mode = %s, want DISABLED", updated.CommentMode)
	}

	got, err := client.GetSeries(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.GetSeriesRequest{
		Tenant:   tenant.tenantContext(),
		PublicId: publicID,
	})
	if err != nil {
		t.Fatalf("GetSeries: %v", err)
	}
	if got.CommentMode != publirattypesv1.CommentMode_COMMENT_MODE_DISABLED {
		t.Fatalf("reloaded comment_mode = %s, want DISABLED", got.CommentMode)
	}

	cleared, err := client.UpdateSeries(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.UpdateSeriesRequest{
		Tenant:      tenant.tenantContext(),
		SeriesId:    env.seriesID(t, publicID),
		Title:       "Quiet Story",
		IsPublished: true,
		CommentMode: publirattypesv1.CommentMode_COMMENT_MODE_UNSPECIFIED.Enum(),
	})
	if err != nil {
		t.Fatalf("UpdateSeries clearing the override: %v", err)
	}
	if cleared.CommentMode != publirattypesv1.CommentMode_COMMENT_MODE_UNSPECIFIED {
		t.Fatalf("cleared comment_mode = %s, want UNSPECIFIED", cleared.CommentMode)
	}
}

// A save that states only the title leaves every listing field as it was,
// including the ones whose stored value is not their default.
func TestDBUpdateSeriesKeepsTheListingFieldsItLeavesUnset(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()

	created, err := client.CreateSeries(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateSeriesRequest{
		Tenant:             tenant.tenantContext(),
		Title:              "Kept Story",
		Synopsis:           "Kept synopsis",
		ReadingPeriodHours: 48,
		IsPublished:        true,
		Status:             publirattypesv1.SeriesStatus_SERIES_STATUS_HIATUS,
		ScheduleWeekdays:   []int32{1, 4},
		AgeRating:          publirattypesv1.SeriesAgeRating_SERIES_AGE_RATING_R15,
		CommentMode:        publirattypesv1.CommentMode_COMMENT_MODE_DISABLED,
		ReadingDirection:   publirattypesv1.ReadingDirection_READING_DIRECTION_LEFT_TO_RIGHT,
		SpreadStartIndex:   new(int32),
	})
	if err != nil {
		t.Fatalf("CreateSeries: %v", err)
	}
	publicID := created.Series.PublicId

	updated, err := client.UpdateSeries(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.UpdateSeriesRequest{
		Tenant:      tenant.tenantContext(),
		SeriesId:    env.seriesID(t, publicID),
		Title:       "Renamed Story",
		IsPublished: true,
	})
	if err != nil {
		t.Fatalf("UpdateSeries: %v", err)
	}
	if updated.Series.Title != "Renamed Story" {
		t.Fatalf("updated title = %q, want Renamed Story", updated.Series.Title)
	}

	got, err := client.GetSeries(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.GetSeriesRequest{
		Tenant:   tenant.tenantContext(),
		PublicId: publicID,
	})
	if err != nil {
		t.Fatalf("GetSeries: %v", err)
	}
	series := got.Series
	if series.Synopsis != "Kept synopsis" || series.ReadingPeriodHours != 48 {
		t.Fatalf("reloaded synopsis, reading_period_hours = %q, %d, want Kept synopsis, 48", series.Synopsis, series.ReadingPeriodHours)
	}
	if series.Status != publirattypesv1.SeriesStatus_SERIES_STATUS_HIATUS || series.AgeRating != publirattypesv1.SeriesAgeRating_SERIES_AGE_RATING_R15 {
		t.Fatalf("reloaded status, age_rating = %s, %s, want HIATUS, R15", series.Status, series.AgeRating)
	}
	if want := []int32{1, 4}; !slices.Equal(series.ScheduleWeekdays, want) {
		t.Fatalf("reloaded schedule_weekdays = %v, want %v", series.ScheduleWeekdays, want)
	}
	if got.CommentMode != publirattypesv1.CommentMode_COMMENT_MODE_DISABLED {
		t.Fatalf("reloaded comment_mode = %s, want DISABLED", got.CommentMode)
	}
	if got.ReadingDirection != publirattypesv1.ReadingDirection_READING_DIRECTION_LEFT_TO_RIGHT || got.SpreadStartIndex != 0 {
		t.Fatalf("reloaded layout = %s from %d, want LEFT_TO_RIGHT from 0", got.ReadingDirection, got.SpreadStartIndex)
	}
}

// Stating a field writes it even when the value is its default: each listing
// field goes back to what a new series carries.
func TestDBUpdateSeriesWritesTheDefaultsItStates(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()

	created, err := client.CreateSeries(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateSeriesRequest{
		Tenant:             tenant.tenantContext(),
		Title:              "Reset Story",
		Synopsis:           "Old synopsis",
		ReadingPeriodHours: 48,
		IsPublished:        true,
		Status:             publirattypesv1.SeriesStatus_SERIES_STATUS_COMPLETED,
		ScheduleWeekdays:   []int32{2},
		AgeRating:          publirattypesv1.SeriesAgeRating_SERIES_AGE_RATING_R18,
		CommentMode:        publirattypesv1.CommentMode_COMMENT_MODE_DISABLED,
		ReadingDirection:   publirattypesv1.ReadingDirection_READING_DIRECTION_LEFT_TO_RIGHT,
		SpreadStartIndex:   new(int32),
	})
	if err != nil {
		t.Fatalf("CreateSeries: %v", err)
	}
	publicID := created.Series.PublicId

	updated, err := client.UpdateSeries(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.UpdateSeriesRequest{
		Tenant:             tenant.tenantContext(),
		SeriesId:           env.seriesID(t, publicID),
		Title:              "Reset Story",
		IsPublished:        true,
		Synopsis:           new(""),
		ReadingPeriodHours: new(int32(0)),
		Status:             publirattypesv1.SeriesStatus_SERIES_STATUS_UNSPECIFIED.Enum(),
		WeeklySchedule:     &publiraadminv1.SeriesScheduleWeekdays{},
		AgeRating:          publirattypesv1.SeriesAgeRating_SERIES_AGE_RATING_UNSPECIFIED.Enum(),
		CommentMode:        publirattypesv1.CommentMode_COMMENT_MODE_UNSPECIFIED.Enum(),
		ReadingDirection:   publirattypesv1.ReadingDirection_READING_DIRECTION_UNSPECIFIED.Enum(),
		SpreadStartIndex:   new(int32(1)),
	})
	if err != nil {
		t.Fatalf("UpdateSeries: %v", err)
	}

	got, err := client.GetSeries(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.GetSeriesRequest{
		Tenant:   tenant.tenantContext(),
		PublicId: updated.Series.PublicId,
	})
	if err != nil {
		t.Fatalf("GetSeries: %v", err)
	}
	series := got.Series
	if series.Synopsis != "" || series.ReadingPeriodHours != 0 {
		t.Fatalf("reloaded synopsis, reading_period_hours = %q, %d, want both cleared", series.Synopsis, series.ReadingPeriodHours)
	}
	if series.Status != publirattypesv1.SeriesStatus_SERIES_STATUS_ONGOING || series.AgeRating != publirattypesv1.SeriesAgeRating_SERIES_AGE_RATING_ALL {
		t.Fatalf("reloaded status, age_rating = %s, %s, want ONGOING, ALL", series.Status, series.AgeRating)
	}
	if len(series.ScheduleWeekdays) != 0 {
		t.Fatalf("reloaded schedule_weekdays = %v, want empty", series.ScheduleWeekdays)
	}
	if got.CommentMode != publirattypesv1.CommentMode_COMMENT_MODE_UNSPECIFIED {
		t.Fatalf("reloaded comment_mode = %s, want UNSPECIFIED", got.CommentMode)
	}
	if got.ReadingDirection != publirattypesv1.ReadingDirection_READING_DIRECTION_RIGHT_TO_LEFT || got.SpreadStartIndex != 1 {
		t.Fatalf("reloaded layout = %s from %d, want RIGHT_TO_LEFT from 1", got.ReadingDirection, got.SpreadStartIndex)
	}
}

// A weekday outside the week never reaches the CHECK constraint: the RPC
// refuses it, and the series keeps the schedule it had.
func TestDBUpdateSeriesRejectsAWeekdayOutsideTheWeek(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()

	created, err := client.CreateSeries(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateSeriesRequest{
		Tenant:           tenant.tenantContext(),
		Title:            "Weekly Story",
		ScheduleWeekdays: []int32{3},
	})
	if err != nil {
		t.Fatalf("CreateSeries: %v", err)
	}

	_, err = client.UpdateSeries(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.UpdateSeriesRequest{
		Tenant:         tenant.tenantContext(),
		SeriesId:       created.Series.Id,
		Title:          "Weekly Story",
		WeeklySchedule: &publiraadminv1.SeriesScheduleWeekdays{Weekdays: []int32{3, 9}},
	})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("UpdateSeries code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}

	got, err := client.GetSeries(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.GetSeriesRequest{
		Tenant:   tenant.tenantContext(),
		PublicId: created.Series.PublicId,
	})
	if err != nil {
		t.Fatalf("GetSeries: %v", err)
	}
	if want := []int32{3}; !slices.Equal(got.Series.ScheduleWeekdays, want) {
		t.Fatalf("schedule_weekdays = %v, want the untouched %v", got.Series.ScheduleWeekdays, want)
	}
}

func TestDBListSeriesExcludesOtherTenants(t *testing.T) {
	env := newAdminDBEnv(t)
	first, second := seedTwoTenants(t, env)
	client := env.seriesClient()

	mine, err := client.CreateSeries(testutil.WithBearer(context.Background(), first.token()), &publiraadminv1.CreateSeriesRequest{
		Tenant: first.tenantContext(),
		Title:  "Tenant A Series",
	})
	if err != nil {
		t.Fatalf("CreateSeries for tenant A: %v", err)
	}
	theirs, err := client.CreateSeries(testutil.WithBearer(context.Background(), second.token()), &publiraadminv1.CreateSeriesRequest{
		Tenant: second.tenantContext(),
		Title:  "Tenant B Series",
	})
	if err != nil {
		t.Fatalf("CreateSeries for tenant B: %v", err)
	}

	listed, err := client.ListSeries(testutil.WithBearer(context.Background(), first.token()), &publiraadminv1.ListSeriesRequest{
		Tenant: first.tenantContext(),
	})
	if err != nil {
		t.Fatalf("ListSeries for tenant A: %v", err)
	}
	got := seriesPublicIDs(listed.Series)
	if !slices.Equal(got, []string{mine.Series.PublicId}) {
		t.Fatalf("tenant A sees %v, want only %s", got, mine.Series.PublicId)
	}

	_, err = client.GetSeries(testutil.WithBearer(context.Background(), first.token()), &publiraadminv1.GetSeriesRequest{
		Tenant:   first.tenantContext(),
		PublicId: theirs.Series.PublicId,
	})
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetSeries across tenants code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
}

func TestDBUpdateSeriesOfAnotherTenantReturnsNotFound(t *testing.T) {
	env := newAdminDBEnv(t)
	first, second := seedTwoTenants(t, env)
	client := env.seriesClient()

	theirs, err := client.CreateSeries(testutil.WithBearer(context.Background(), second.token()), &publiraadminv1.CreateSeriesRequest{
		Tenant: second.tenantContext(),
		Title:  "Tenant B Series",
	})
	if err != nil {
		t.Fatalf("CreateSeries for tenant B: %v", err)
	}

	_, err = client.UpdateSeries(testutil.WithBearer(context.Background(), first.token()), &publiraadminv1.UpdateSeriesRequest{
		Tenant:   first.tenantContext(),
		SeriesId: theirs.Series.Id,
		Title:    "Hijacked Title",
	})
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("UpdateSeries across tenants code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}

	// The write must not have landed anyway.
	if count := env.countRows(t, "SELECT count(*) FROM series WHERE title = $1", "Hijacked Title"); count != 0 {
		t.Fatalf("series titled Hijacked Title = %d, want 0", count)
	}
}

func TestDBSeriesSessionOfAnotherTenantIsRejected(t *testing.T) {
	env := newAdminDBEnv(t)
	first, second := seedTwoTenants(t, env)
	client := env.seriesClient()

	// Tenant B's admin token pointed at tenant A: the session lookup runs under
	// tenant A's RLS context, where that user does not exist.
	req := &publiraadminv1.ListSeriesRequest{Tenant: first.tenantContext()}
	_, err := client.ListSeries(testutil.WithBearer(context.Background(), second.token()), req)
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("ListSeries with a foreign session code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}
}

func TestDBCreateSeriesRejectsEmptyTitle(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")

	_, err := env.seriesClient().CreateSeries(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateSeriesRequest{
		Tenant: tenant.tenantContext(),
		Title:  "   ",
	})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("CreateSeries code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	if count := env.countRows(t, "SELECT count(*) FROM series"); count != 0 {
		t.Fatalf("series rows = %d, want 0 after a rejected create", count)
	}
}

func TestDBCreateSeriesWithUnknownLabelReturnsInvalidArgument(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")

	_, err := env.seriesClient().CreateSeries(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateSeriesRequest{
		Tenant:  tenant.tenantContext(),
		Title:   "Series With Label",
		LabelId: uuid.NewString(),
	})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("CreateSeries code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
}

func TestDBCreateSeriesUnknownCreatorLeavesNoRows(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")

	_, err := env.seriesClient().CreateSeries(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateSeriesRequest{
		Tenant:         tenant.tenantContext(),
		Title:          "Orphan Series",
		Synopsis:       "Should not persist",
		CreatorCredits: []*publiraadminv1.SeriesCreatorCredit{{CreatorId: uuid.NewString(), RoleId: env.leadingCreatorRoleID(t, tenant)}},
	})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("CreateSeries code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	if count := env.countRows(t, "SELECT count(*) FROM series WHERE tenant_id = $1", tenant.Tenant.ID); count != 0 {
		t.Fatalf("series rows = %d, want 0 after a rejected create", count)
	}
	if count := env.countRows(t, "SELECT count(*) FROM series_listings WHERE tenant_id = $1", tenant.Tenant.ID); count != 0 {
		t.Fatalf("series_listings rows = %d, want 0 after a rejected create", count)
	}
	if count := env.countRows(t, "SELECT count(*) FROM series_creators WHERE tenant_id = $1", tenant.Tenant.ID); count != 0 {
		t.Fatalf("series_creators rows = %d, want 0 after a rejected create", count)
	}
}

func TestDBUpdateSeriesUnknownCreatorPreservesExistingLinks(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()

	createdCreator, err := env.creatorClient().CreateCreator(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateCreatorRequest{
		Tenant: tenant.tenantContext(),
		Name:   "Existing Creator",
	})
	if err != nil {
		t.Fatalf("CreateCreator: %v", err)
	}
	creatorPublicID := createdCreator.Creator.PublicId

	created, err := client.CreateSeries(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateSeriesRequest{
		Tenant:         tenant.tenantContext(),
		Title:          "Original Title",
		Synopsis:       "Original synopsis",
		CreatorCredits: env.creatorCredits(t, tenant, createdCreator.Creator.Id),
	})
	if err != nil {
		t.Fatalf("CreateSeries: %v", err)
	}
	publicID := created.Series.PublicId

	_, err = client.UpdateSeries(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.UpdateSeriesRequest{
		Tenant:         tenant.tenantContext(),
		SeriesId:       env.seriesID(t, publicID),
		Title:          "Hijacked Title",
		Synopsis:       new("Hijacked synopsis"),
		CreatorCredits: []*publiraadminv1.SeriesCreatorCredit{{CreatorId: uuid.NewString(), RoleId: env.leadingCreatorRoleID(t, tenant)}},
	})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("UpdateSeries code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}

	got, err := client.GetSeries(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.GetSeriesRequest{
		Tenant:   tenant.tenantContext(),
		PublicId: publicID,
	})
	if err != nil {
		t.Fatalf("GetSeries after failed update: %v", err)
	}
	if got.Series.Title != "Original Title" {
		t.Fatalf("title after failed update = %q, want Original Title", got.Series.Title)
	}
	if got.Series.Synopsis != "Original synopsis" {
		t.Fatalf("synopsis after failed update = %q, want Original synopsis", got.Series.Synopsis)
	}
	if len(got.Series.Creators) != 1 || got.Series.Creators[0].PublicId != creatorPublicID {
		t.Fatalf("creators after failed update = %+v, want the original creator %s", got.Series.Creators, creatorPublicID)
	}
	if count := env.countRows(t, "SELECT count(*) FROM series_creators WHERE tenant_id = $1", tenant.Tenant.ID); count != 1 {
		t.Fatalf("series_creators rows = %d, want 1 after a rejected update", count)
	}
	if count := env.countRows(t, "SELECT count(*) FROM series WHERE title = $1", "Hijacked Title"); count != 0 {
		t.Fatalf("series titled Hijacked Title = %d, want 0", count)
	}
}

func TestDBSeriesCreditSharesReadBack(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()

	creatorIDs := make([]string, 0, 2)
	for _, name := range []string{"Share Author", "Share Artist"} {
		created, err := env.creatorClient().CreateCreator(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateCreatorRequest{
			Tenant: tenant.tenantContext(),
			Name:   name,
		})
		if err != nil {
			t.Fatalf("CreateCreator %s: %v", name, err)
		}
		creatorIDs = append(creatorIDs, created.Creator.Id)
	}
	credits := env.creatorCredits(t, tenant, creatorIDs...)
	credits[0].ShareBps = 1000

	created, err := client.CreateSeries(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateSeriesRequest{
		Tenant:         tenant.tenantContext(),
		Title:          "Shared Series",
		CreatorCredits: credits,
	})
	if err != nil {
		t.Fatalf("CreateSeries: %v", err)
	}
	if got := seriesCreditShares(created.CreatorCredits); !slices.Equal(got, []int32{1000, 0}) {
		t.Fatalf("CreateSeries shares = %v, want [1000 0]", got)
	}

	credits[0].ShareBps = 3000
	credits[1].ShareBps = 2000
	updated, err := client.UpdateSeries(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.UpdateSeriesRequest{
		Tenant:         tenant.tenantContext(),
		SeriesId:       created.Series.Id,
		Title:          "Shared Series",
		CreatorCredits: credits,
	})
	if err != nil {
		t.Fatalf("UpdateSeries: %v", err)
	}
	if got := seriesCreditShares(updated.CreatorCredits); !slices.Equal(got, []int32{3000, 2000}) {
		t.Fatalf("UpdateSeries shares = %v, want [3000 2000]", got)
	}

	got, err := client.GetSeries(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.GetSeriesRequest{
		Tenant:   tenant.tenantContext(),
		PublicId: created.Series.PublicId,
	})
	if err != nil {
		t.Fatalf("GetSeries: %v", err)
	}
	for index, credit := range got.CreatorCredits {
		if credit.CreatorId != credits[index].CreatorId || credit.RoleId != credits[index].RoleId {
			t.Fatalf("GetSeries credit %d = %+v, want %+v", index, credit, credits[index])
		}
	}
	if shares := seriesCreditShares(got.CreatorCredits); !slices.Equal(shares, []int32{3000, 2000}) {
		t.Fatalf("GetSeries shares = %v, want [3000 2000]", shares)
	}
}

func seriesCreditShares(credits []*publiraadminv1.SeriesCreatorCredit) []int32 {
	shares := make([]int32, 0, len(credits))
	for _, credit := range credits {
		shares = append(shares, credit.ShareBps)
	}
	return shares
}

func TestDBListSeriesPaginatesWithTokens(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()

	createdPublicIDs := make([]string, 0, 3)
	for _, title := range []string{"First", "Second", "Third"} {
		resp, err := client.CreateSeries(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateSeriesRequest{
			Tenant: tenant.tenantContext(),
			Title:  title + " Series",
		})
		if err != nil {
			t.Fatalf("CreateSeries %s: %v", title, err)
		}
		createdPublicIDs = append(createdPublicIDs, resp.Series.PublicId)
	}

	first, err := client.ListSeries(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.ListSeriesRequest{
		Tenant: tenant.tenantContext(),
		Limit:  2,
	})
	if err != nil {
		t.Fatalf("ListSeries first page: %v", err)
	}
	if len(first.Series) != 2 || first.PreviousToken != "" || first.NextToken == "" {
		t.Fatalf("first page = %d series, tokens (%q, %q); want 2, empty previous, non-empty next",
			len(first.Series), first.PreviousToken, first.NextToken)
	}

	second, err := client.ListSeries(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.ListSeriesRequest{
		Tenant: tenant.tenantContext(),
		Limit:  2,
		Token:  first.NextToken,
	})
	if err != nil {
		t.Fatalf("ListSeries second page: %v", err)
	}
	if len(second.Series) != 1 || second.PreviousToken == "" || second.NextToken != "" {
		t.Fatalf("second page = %d series, tokens (%q, %q); want 1, non-empty previous, empty next",
			len(second.Series), second.PreviousToken, second.NextToken)
	}

	listed := append(seriesPublicIDs(first.Series), seriesPublicIDs(second.Series)...)
	slices.Sort(listed)
	slices.Sort(createdPublicIDs)
	if !slices.Equal(listed, createdPublicIDs) {
		t.Fatalf("paged public IDs = %v, want %v", listed, createdPublicIDs)
	}

	back, err := client.ListSeries(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.ListSeriesRequest{
		Tenant: tenant.tenantContext(),
		Limit:  2,
		Token:  second.PreviousToken,
	})
	if err != nil {
		t.Fatalf("ListSeries previous page: %v", err)
	}
	if !slices.Equal(seriesPublicIDs(back.Series), seriesPublicIDs(first.Series)) {
		t.Fatalf("previous page = %v, want %v", seriesPublicIDs(back.Series), seriesPublicIDs(first.Series))
	}
}
