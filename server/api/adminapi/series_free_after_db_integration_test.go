package adminapi

import (
	"context"
	"fmt"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"
	"google.golang.org/protobuf/proto"

	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/freeafter"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// freeAfterEnd is the end every window a rule writes carries.
const freeAfterEnd = "9999-12-31T00:00:00Z"

// A series nobody configured answers the defaults, an editor saves the whole
// rule, and turning it off keeps the numbers for the next time it is on.
func TestDBSeriesFreeAfterSettingsRoundTrip(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	editor := admin.as(env.PG.SeedTenantUser(t, admin.Tenant.ID, "TAEDITOR01", "editor@tenant-a.example.com", "Editor", auth.RoleTenantEditor))
	client := env.seriesClient()
	seriesID := env.seriesID(t, createDBSeries(t, client, admin, "Free After Series"))

	get := func(t *testing.T) *publiraadminv1.SeriesFreeAfterSettings {
		t.Helper()
		resp, err := client.GetSeriesFreeAfterSettings(testutil.WithBearer(context.Background(), editor.token()), &publiraadminv1.GetSeriesFreeAfterSettingsRequest{
			Tenant:   editor.tenantContext(),
			SeriesId: seriesID,
		})
		if err != nil {
			t.Fatalf("GetSeriesFreeAfterSettings: %v", err)
		}
		return resp.Settings
	}

	defaults := &publiraadminv1.SeriesFreeAfterSettings{DaysAfterPublication: 30}
	if got := get(t); !proto.Equal(got, defaults) {
		t.Fatalf("settings of an unconfigured series = %v, want %v", got, defaults)
	}

	on := &publiraadminv1.SeriesFreeAfterSettings{Enabled: true, DaysAfterPublication: 14, ExcludedLatestCount: 3}
	if got := updateFreeAfter(t, env, editor, seriesID, on); !proto.Equal(got, on) {
		t.Fatalf("saved settings = %v, want %v", got, on)
	}
	if got := get(t); !proto.Equal(got, on) {
		t.Fatalf("settings read back = %v, want %v", got, on)
	}
	if got := env.countRows(t,
		"SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = 'series_free_after_settings_updated' AND target_type = 'series' AND outcome = 'success'",
		admin.Tenant.ID,
	); got != 1 {
		t.Fatalf("audit rows = %d, want 1", got)
	}

	off := &publiraadminv1.SeriesFreeAfterSettings{DaysAfterPublication: 14, ExcludedLatestCount: 3}
	updateFreeAfter(t, env, editor, seriesID, off)
	if got := get(t); !proto.Equal(got, off) {
		t.Fatalf("settings after turning the rule off = %v, want %v", got, off)
	}
}

func TestDBUpdateSeriesFreeAfterSettingsRefusals(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	other := env.seedTenantWithAdmin(t, "TENANTB", "tenant-b.example.com", "Tenant B", "TBUSER01", "admin@tenant-b.example.com")
	client := env.seriesClient()
	seriesID := env.seriesID(t, createDBSeries(t, client, tenant, "Free After Series"))
	otherSeriesID := env.seriesID(t, createDBSeries(t, client, other, "Elsewhere"))

	valid := func() *publiraadminv1.SeriesFreeAfterSettings {
		return &publiraadminv1.SeriesFreeAfterSettings{Enabled: true, DaysAfterPublication: 30}
	}
	for _, tt := range []struct {
		name     string
		seriesID string
		settings *publiraadminv1.SeriesFreeAfterSettings
		code     connect.Code
	}{
		{name: "no settings", seriesID: seriesID, code: connect.CodeInvalidArgument},
		{name: "no days", seriesID: seriesID, settings: &publiraadminv1.SeriesFreeAfterSettings{Enabled: true}, code: connect.CodeInvalidArgument},
		{name: "days past ten years", seriesID: seriesID, settings: &publiraadminv1.SeriesFreeAfterSettings{Enabled: true, DaysAfterPublication: 3651}, code: connect.CodeInvalidArgument},
		{name: "a negative exclusion", seriesID: seriesID, settings: &publiraadminv1.SeriesFreeAfterSettings{Enabled: true, DaysAfterPublication: 30, ExcludedLatestCount: -1}, code: connect.CodeInvalidArgument},
		{name: "a malformed series id", seriesID: "not-an-id", settings: valid(), code: connect.CodeInvalidArgument},
		{name: "a series that does not exist", seriesID: uuid.Must(uuid.NewV7()).String(), settings: valid(), code: connect.CodeNotFound},
		{name: "another tenant's series", seriesID: otherSeriesID, settings: valid(), code: connect.CodeNotFound},
	} {
		t.Run(tt.name, func(t *testing.T) {
			_, err := client.UpdateSeriesFreeAfterSettings(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.UpdateSeriesFreeAfterSettingsRequest{
				Tenant:   tenant.tenantContext(),
				SeriesId: tt.seriesID,
				Settings: tt.settings,
			})
			if connect.CodeOf(err) != tt.code {
				t.Fatalf("code = %v, want %v (err=%v)", connect.CodeOf(err), tt.code, err)
			}
		})
	}

	_, err := client.GetSeriesFreeAfterSettings(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.GetSeriesFreeAfterSettingsRequest{
		Tenant:   tenant.tenantContext(),
		SeriesId: otherSeriesID,
	})
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("reading another tenant's rule: code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
}

// The rule as a publisher runs it: thirty days, the two newest kept priced.
// Each pass of the worker opens what has reached its day, a new episode moves
// the newest two along, and turning the rule off prices every episode it
// opened again while a window scheduled by hand stays.
func TestDBFreeAfterRuleOpensEpisodesAsTheyReachTheirDay(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()
	series := env.PG.SeedSeries(t, admin.Tenant.ID, testutil.SeriesSeed{PublicID: "FREEAFTER001", Title: "Free After Series", Published: true})
	seriesID := series.ID.String()

	episodes := make([]testutil.Episode, 0, 6)
	for i := range 5 {
		episodes = append(episodes, env.PG.SeedEpisode(t, admin.Tenant.ID, series.ID, testutil.EpisodeSeed{
			PublicID:    fmt.Sprintf("FREEAFTEREP%d", i+1),
			Title:       fmt.Sprintf("Chapter %d", i+1),
			Status:      testutil.EpisodeStatusPublished,
			Price:       500,
			PublishedAt: time.Now().Add(-40 * 24 * time.Hour),
		}))
	}

	updateFreeAfter(t, env, admin, seriesID, &publiraadminv1.SeriesFreeAfterSettings{Enabled: true, DaysAfterPublication: 30, ExcludedLatestCount: 2})
	runFreeAfterPass(t, env)
	assertFreeEpisodes(t, env, series.ID, episodes[0].ID, episodes[1].ID, episodes[2].ID)

	windows := listSeriesFreeWindows(t, env, admin, seriesID)
	if len(windows) != 3 {
		t.Fatalf("windows listed = %d, want the 3 the rule wrote", len(windows))
	}
	for _, window := range windows {
		if window.RuleSeriesId != seriesID || window.EndsAt != freeAfterEnd {
			t.Fatalf("window %s: rule_series_id = %q, ends_at = %q, want %q and %q", window.EpisodePublicId, window.RuleSeriesId, window.EndsAt, seriesID, freeAfterEnd)
		}
	}
	// What a reader's client is told the episode is free until.
	if got := env.countRows(t,
		"SELECT count(*) FROM published_free_episodes WHERE series_id = $1 AND free_until = '9999-12-31T00:00:00Z'",
		series.ID,
	); got != 3 {
		t.Fatalf("free episodes free until the far end = %d, want 3", got)
	}
	if got := env.countRows(t,
		"SELECT count(*) FROM episode_free_windows WHERE rule_series_id = $1 AND start_revalidated_at IS NULL",
		series.ID,
	); got != 0 {
		t.Fatalf("rule windows with their start still owed = %d, want 0: the pass that wrote them open writes their start off", got)
	}

	// A second pass finds nothing left to write.
	runFreeAfterPass(t, env)
	if got := env.countRows(t, "SELECT count(*) FROM episode_free_windows WHERE rule_series_id = $1", series.ID); got != 3 {
		t.Fatalf("rule windows after a second pass = %d, want 3", got)
	}

	// The rule's window would only be written again, so it cannot be deleted.
	_, err := client.DeleteEpisodeFreeWindow(testutil.WithBearer(context.Background(), admin.token()), &publiraadminv1.DeleteEpisodeFreeWindowRequest{
		Tenant:       admin.tenantContext(),
		FreeWindowId: windows[0].Id,
	})
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("deleting a rule's window: code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}

	episodes = append(episodes, env.PG.SeedEpisode(t, admin.Tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID:    "FREEAFTEREP6",
		Title:       "Chapter 6",
		Status:      testutil.EpisodeStatusPublished,
		Price:       500,
		PublishedAt: time.Now().Add(-time.Minute),
	}))
	runFreeAfterPass(t, env)
	assertFreeEpisodes(t, env, series.ID, episodes[0].ID, episodes[1].ID, episodes[2].ID, episodes[3].ID)

	// Keeping one more back takes the window off the episode that is now
	// among the newest three, at once.
	updateFreeAfter(t, env, admin, seriesID, &publiraadminv1.SeriesFreeAfterSettings{Enabled: true, DaysAfterPublication: 30, ExcludedLatestCount: 3})
	assertFreeEpisodes(t, env, series.ID, episodes[0].ID, episodes[1].ID, episodes[2].ID)

	// A window scheduled by hand on a priced episode is not the rule's.
	base := time.Now().UTC().Add(time.Hour).Truncate(time.Second)
	manual, err := client.CreateEpisodeFreeWindow(testutil.WithBearer(context.Background(), admin.token()), &publiraadminv1.CreateEpisodeFreeWindowRequest{
		Tenant:    admin.tenantContext(),
		EpisodeId: episodes[4].ID.String(),
		StartsAt:  rfc3339(base),
		EndsAt:    rfc3339(base.Add(time.Hour)),
	})
	if err != nil {
		t.Fatalf("CreateEpisodeFreeWindow: %v", err)
	}
	if manual.FreeWindow.RuleSeriesId != "" {
		t.Fatalf("a window scheduled by hand names rule %q, want none", manual.FreeWindow.RuleSeriesId)
	}

	updateFreeAfter(t, env, admin, seriesID, &publiraadminv1.SeriesFreeAfterSettings{DaysAfterPublication: 30, ExcludedLatestCount: 3})
	assertFreeEpisodes(t, env, series.ID)
	if got := freeWindowIDs(listSeriesFreeWindows(t, env, admin, seriesID)); !slices.Equal(got, []string{manual.FreeWindow.Id}) {
		t.Fatalf("windows listed after turning the rule off = %v, want only the one scheduled by hand", got)
	}
	runFreeAfterPass(t, env)
	assertFreeEpisodes(t, env, series.ID)

	if _, err := client.DeleteEpisodeFreeWindow(testutil.WithBearer(context.Background(), admin.token()), &publiraadminv1.DeleteEpisodeFreeWindowRequest{
		Tenant:       admin.tenantContext(),
		FreeWindowId: manual.FreeWindow.Id,
	}); err != nil {
		t.Fatalf("DeleteEpisodeFreeWindow on a window scheduled by hand: %v", err)
	}
}

// Two windows of one episode cannot overlap, so a window scheduled by hand
// that is still open on the day the rule reaches holds the rule's back until
// it ends, and the episode stays free across the two.
func TestDBFreeAfterRuleStartsWhereAWindowScheduledByHandEnds(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()
	series := env.PG.SeedSeries(t, admin.Tenant.ID, testutil.SeriesSeed{PublicID: "FREEAFTER002", Title: "Free After Series", Published: true})
	episode := env.PG.SeedEpisode(t, admin.Tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID:    "FREEAFTEREP1",
		Title:       "Chapter 1",
		Status:      testutil.EpisodeStatusPublished,
		Price:       500,
		PublishedAt: time.Now().Add(-40 * 24 * time.Hour),
	})

	manualEnd := time.Now().UTC().Add(time.Hour).Truncate(time.Second)
	if _, err := client.CreateEpisodeFreeWindow(testutil.WithBearer(context.Background(), admin.token()), &publiraadminv1.CreateEpisodeFreeWindowRequest{
		Tenant:    admin.tenantContext(),
		EpisodeId: episode.ID.String(),
		StartsAt:  rfc3339(time.Now().Add(-time.Hour)),
		EndsAt:    rfc3339(manualEnd),
	}); err != nil {
		t.Fatalf("CreateEpisodeFreeWindow: %v", err)
	}

	updateFreeAfter(t, env, admin, series.ID.String(), &publiraadminv1.SeriesFreeAfterSettings{Enabled: true, DaysAfterPublication: 30})
	runFreeAfterPass(t, env)

	var ruleWindows []*publiraadminv1.AdminEpisodeFreeWindow
	for _, window := range listSeriesFreeWindows(t, env, admin, series.ID.String()) {
		if window.RuleSeriesId != "" {
			ruleWindows = append(ruleWindows, window)
		}
	}
	if len(ruleWindows) != 1 {
		t.Fatalf("rule windows = %d, want 1", len(ruleWindows))
	}
	if ruleWindows[0].StartsAt != rfc3339(manualEnd) {
		t.Fatalf("rule window starts at %s, want where the window scheduled by hand ends, %s", ruleWindows[0].StartsAt, rfc3339(manualEnd))
	}
	assertFreeEpisodes(t, env, series.ID, episode.ID)
}

// An episode reordered among the newest leaves the rule, and the next pass
// takes its window away without the rule being saved again.
func TestDBFreeAfterRulePassRemovesTheWindowOfAnEpisodeReorderedAmongTheNewest(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()
	series := env.PG.SeedSeries(t, admin.Tenant.ID, testutil.SeriesSeed{PublicID: "FREEAFTER003", Title: "Free After Series", Published: true})

	episodes := make([]testutil.Episode, 0, 3)
	for i := range 3 {
		episodes = append(episodes, env.PG.SeedEpisode(t, admin.Tenant.ID, series.ID, testutil.EpisodeSeed{
			PublicID:    fmt.Sprintf("FREEAFTEREP%d", i+1),
			Title:       fmt.Sprintf("Chapter %d", i+1),
			Status:      testutil.EpisodeStatusPublished,
			Price:       500,
			PublishedAt: time.Now().Add(-40 * 24 * time.Hour),
		}))
	}

	updateFreeAfter(t, env, admin, series.ID.String(), &publiraadminv1.SeriesFreeAfterSettings{Enabled: true, DaysAfterPublication: 30, ExcludedLatestCount: 1})
	runFreeAfterPass(t, env)
	assertFreeEpisodes(t, env, series.ID, episodes[0].ID, episodes[1].ID)

	ids := func(order ...testutil.Episode) []string {
		out := make([]string, 0, len(order))
		for _, episode := range order {
			out = append(out, episode.ID.String())
		}
		return out
	}
	if _, err := client.ReorderEpisodes(testutil.WithBearer(context.Background(), admin.token()), &publiraadminv1.ReorderEpisodesRequest{
		Tenant:             admin.tenantContext(),
		SeriesId:           series.ID.String(),
		EpisodeIds:         ids(episodes[1], episodes[2], episodes[0]),
		ExpectedEpisodeIds: ids(episodes...),
	}); err != nil {
		t.Fatalf("ReorderEpisodes: %v", err)
	}

	runFreeAfterPass(t, env)
	assertFreeEpisodes(t, env, series.ID, episodes[1].ID, episodes[2].ID)
}

// A rule's window waiting behind a window scheduled by hand starts on the
// rule's own day again once that window is deleted, so the episode is not
// priced for the rest of the period that no longer exists.
func TestDBFreeAfterRulePassBringsAWindowForwardWhenTheOneItWaitedOnIsDeleted(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()
	series := env.PG.SeedSeries(t, admin.Tenant.ID, testutil.SeriesSeed{PublicID: "FREEAFTER004", Title: "Free After Series", Published: true})
	publishedAt := time.Now().UTC().Add(-40 * 24 * time.Hour).Truncate(time.Second)
	episode := env.PG.SeedEpisode(t, admin.Tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID:    "FREEAFTEREP1",
		Title:       "Chapter 1",
		Status:      testutil.EpisodeStatusPublished,
		Price:       500,
		PublishedAt: publishedAt,
	})

	manual, err := client.CreateEpisodeFreeWindow(testutil.WithBearer(context.Background(), admin.token()), &publiraadminv1.CreateEpisodeFreeWindowRequest{
		Tenant:    admin.tenantContext(),
		EpisodeId: episode.ID.String(),
		StartsAt:  rfc3339(time.Now().Add(-time.Hour)),
		EndsAt:    rfc3339(time.Now().Add(time.Hour)),
	})
	if err != nil {
		t.Fatalf("CreateEpisodeFreeWindow: %v", err)
	}
	updateFreeAfter(t, env, admin, series.ID.String(), &publiraadminv1.SeriesFreeAfterSettings{Enabled: true, DaysAfterPublication: 30})
	runFreeAfterPass(t, env)

	if _, err := client.DeleteEpisodeFreeWindow(testutil.WithBearer(context.Background(), admin.token()), &publiraadminv1.DeleteEpisodeFreeWindowRequest{
		Tenant:       admin.tenantContext(),
		FreeWindowId: manual.FreeWindow.Id,
	}); err != nil {
		t.Fatalf("DeleteEpisodeFreeWindow: %v", err)
	}
	assertFreeEpisodes(t, env, series.ID)

	runFreeAfterPass(t, env)
	assertFreeEpisodes(t, env, series.ID, episode.ID)
	windows := listSeriesFreeWindows(t, env, admin, series.ID.String())
	if len(windows) != 1 || windows[0].StartsAt != rfc3339(publishedAt.Add(30*24*time.Hour)) {
		t.Fatalf("windows after the pass = %v, want the rule's alone, starting 30 days after publication", windows)
	}
	if got := env.countRows(t,
		"SELECT count(*) FROM episode_free_windows WHERE rule_series_id = $1 AND start_revalidated_at IS NULL",
		series.ID,
	); got != 0 {
		t.Fatalf("rule windows with their start still owed = %d, want 0: the pass that moved it open writes its start off", got)
	}
}

func updateFreeAfter(t *testing.T, env *adminDBEnv, caller adminDBTenant, seriesID string, settings *publiraadminv1.SeriesFreeAfterSettings) *publiraadminv1.SeriesFreeAfterSettings {
	t.Helper()
	resp, err := env.seriesClient().UpdateSeriesFreeAfterSettings(testutil.WithBearer(context.Background(), caller.token()), &publiraadminv1.UpdateSeriesFreeAfterSettingsRequest{
		Tenant:   caller.tenantContext(),
		SeriesId: seriesID,
		Settings: settings,
	})
	if err != nil {
		t.Fatalf("UpdateSeriesFreeAfterSettings: %v", err)
	}
	return resp.Settings
}

// runFreeAfterPass runs one pass of the worker's job, on the role it runs as.
func runFreeAfterPass(t *testing.T, env *adminDBEnv) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	ticker := env.PG.OpenTickerDB(t)
	freeafter.New(ticker, nil, nil, nil).RunOnce(ctx)
}

func listSeriesFreeWindows(t *testing.T, env *adminDBEnv, caller adminDBTenant, seriesID string) []*publiraadminv1.AdminEpisodeFreeWindow {
	t.Helper()
	resp, err := env.seriesClient().ListEpisodeFreeWindows(testutil.WithBearer(context.Background(), caller.token()), &publiraadminv1.ListEpisodeFreeWindowsRequest{
		Tenant: caller.tenantContext(),
		Scope:  listFreeWindowsBySeries(seriesID),
		Limit:  100,
	})
	if err != nil {
		t.Fatalf("ListEpisodeFreeWindows: %v", err)
	}
	return resp.FreeWindows
}

// assertFreeEpisodes compares the series' episodes every reader may open free
// right now, as published_free_episodes answers every read that decides it,
// with want.
func assertFreeEpisodes(t *testing.T, env *adminDBEnv, seriesID uuid.UUID, want ...uuid.UUID) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	rows, err := env.PG.DB.QueryContext(ctx,
		"SELECT episode_id FROM published_free_episodes WHERE series_id = $1",
		seriesID,
	)
	if err != nil {
		t.Fatalf("read free episodes: %v", err)
	}
	defer rows.Close() //nolint:errcheck

	got := make([]uuid.UUID, 0, len(want))
	for rows.Next() {
		var episodeID uuid.UUID
		if err := rows.Scan(&episodeID); err != nil {
			t.Fatalf("scan free episode: %v", err)
		}
		got = append(got, episodeID)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("read free episodes: %v", err)
	}

	sortUUIDs := func(ids []uuid.UUID) {
		slices.SortFunc(ids, func(a, b uuid.UUID) int { return slices.Compare(a[:], b[:]) })
	}
	sortUUIDs(got)
	sortUUIDs(want)
	if !slices.Equal(got, want) {
		t.Fatalf("free episodes = %v, want %v", got, want)
	}
}
