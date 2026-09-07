package publicapi

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

func saveReadingPositionRequest(tenant testutil.Tenant, episodePublicID string, pageIndex int32, token string) *connect.Request[publirav1.SaveReadingPositionRequest] {
	return newBearerRequest(&publirav1.SaveReadingPositionRequest{
		Tenant:          tenantContext(tenant),
		EpisodePublicId: episodePublicID,
		PageIndex:       pageIndex,
	}, token)
}

func getReadingPositionRequest(tenant testutil.Tenant, episodePublicID, token string) *connect.Request[publirav1.GetMyReadingPositionRequest] {
	return newBearerRequest(&publirav1.GetMyReadingPositionRequest{
		Tenant:          tenantContext(tenant),
		EpisodePublicId: episodePublicID,
	}, token)
}

func seriesProgressRequest(tenant testutil.Tenant, seriesPublicID, token string) *connect.Request[publirav1.GetMySeriesProgressRequest] {
	return newBearerRequest(&publirav1.GetMySeriesProgressRequest{
		Tenant:         tenantContext(tenant),
		SeriesPublicId: seriesPublicID,
	}, token)
}

// seedEpisodeWithPages seeds an episode and the page images the saved position
// is measured against.
func seedEpisodeWithPages(t *testing.T, env *publicDBEnv, tenantID, seriesID uuid.UUID, seed testutil.EpisodeSeed, pages int32) testutil.Episode {
	t.Helper()

	episode := env.PG.SeedEpisode(t, tenantID, seriesID, seed)
	for page := range pages {
		env.PG.SeedEpisodeImage(t, tenantID, episode.ID, page)
	}
	return episode
}

func TestDBSaveReadingPositionKeepsOneRowAndReturnsItToTheSameReader(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTPOSA", "position-a.example.com", "Position A")
	member := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERPOSA", "member-position-a@example.com", "Member A", "tenant_member")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESPOSA", Title: "Public series", Published: true})
	episode := seedEpisodeWithPages(t, env, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEPOSA", Title: "Free episode", Status: testutil.EpisodeStatusPublished}, 40)
	client := env.episodeReadClient()
	token := tokenFor(t, tenant, member)

	saved, err := client.SaveReadingPosition(context.Background(), saveReadingPositionRequest(tenant, episode.PublicID, 11, token))
	if err != nil {
		t.Fatalf("SaveReadingPosition: %v", err)
	}
	if got, want := saved.Msg.Position.GetPageIndex(), int32(11); got != want {
		t.Fatalf("saved page_index = %d, want %d", got, want)
	}
	if got, want := saved.Msg.Position.GetPageCount(), int32(40); got != want {
		t.Fatalf("saved page_count = %d, want the episode's own %d", got, want)
	}

	read, err := client.GetMyReadingPosition(context.Background(), getReadingPositionRequest(tenant, episode.PublicID, token))
	if err != nil {
		t.Fatalf("GetMyReadingPosition: %v", err)
	}
	if got, want := read.Msg.Position.GetPageIndex(), int32(11); got != want {
		t.Fatalf("read page_index = %d, want %d", got, want)
	}

	again, err := client.SaveReadingPosition(context.Background(), saveReadingPositionRequest(tenant, episode.PublicID, 11, token))
	if err != nil {
		t.Fatalf("repeated SaveReadingPosition: %v", err)
	}
	if again.Msg.Position.GetUpdatedAt() != saved.Msg.Position.GetUpdatedAt() {
		t.Fatalf("repeated save updated_at = %q, want the unchanged %q", again.Msg.Position.GetUpdatedAt(), saved.Msg.Position.GetUpdatedAt())
	}

	back, err := client.SaveReadingPosition(context.Background(), saveReadingPositionRequest(tenant, episode.PublicID, 4, token))
	if err != nil {
		t.Fatalf("SaveReadingPosition after going back: %v", err)
	}
	if got, want := back.Msg.Position.GetPageIndex(), int32(4); got != want {
		t.Fatalf("page_index after going back = %d, want %d", got, want)
	}
	if back.Msg.Position.GetUpdatedAt() == saved.Msg.Position.GetUpdatedAt() {
		t.Fatalf("updated_at stayed %q after the reader moved", back.Msg.Position.GetUpdatedAt())
	}

	if got := env.countRows(t, "SELECT COUNT(*) FROM episode_reading_positions WHERE tenant_id = $1 AND user_id = $2 AND episode_id = $3", tenant.ID, member.ID, episode.ID); got != 1 {
		t.Fatalf("reading position rows = %d, want 1", got)
	}
}

func TestDBSaveReadingPositionRejectsAPageOutsideTheEpisode(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTPOSB", "position-b.example.com", "Position B")
	member := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERPOSB", "member-position-b@example.com", "Member B", "tenant_member")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESPOSB", Title: "Public series", Published: true})
	episode := seedEpisodeWithPages(t, env, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEPOSB", Title: "Three pages", Status: testutil.EpisodeStatusPublished}, 3)
	pageless := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEPOSC", Title: "No pages yet", Status: testutil.EpisodeStatusPublished})
	client := env.episodeReadClient()
	token := tokenFor(t, tenant, member)

	if _, err := client.SaveReadingPosition(context.Background(), saveReadingPositionRequest(tenant, episode.PublicID, 2, token)); err != nil {
		t.Fatalf("SaveReadingPosition on the last page: %v", err)
	}
	for _, pageIndex := range []int32{3, -1} {
		_, err := client.SaveReadingPosition(context.Background(), saveReadingPositionRequest(tenant, episode.PublicID, pageIndex, token))
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("SaveReadingPosition page %d code = %v, want invalid_argument (err=%v)", pageIndex, connect.CodeOf(err), err)
		}
	}
	_, err := client.SaveReadingPosition(context.Background(), saveReadingPositionRequest(tenant, pageless.PublicID, 0, token))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("SaveReadingPosition on a pageless episode code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}

	if got := env.countRows(t, "SELECT COUNT(*) FROM episode_reading_positions WHERE tenant_id = $1 AND user_id = $2", tenant.ID, member.ID); got != 1 {
		t.Fatalf("reading position rows = %d, want only the accepted one", got)
	}
}

func TestDBReadingPositionRequiresCurrentPublicationAndBodyAccess(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant, otherTenant := env.seedTwoTenants(t)
	member := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERPOSC", "member-position-c@example.com", "Member C", "tenant_member")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESPOSC", Title: "Public series", Published: true})
	free := seedEpisodeWithPages(t, env, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEPOSD", Title: "Free", Status: testutil.EpisodeStatusPublished}, 10)
	paid := seedEpisodeWithPages(t, env, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEPOSE", Title: "Paid", Status: testutil.EpisodeStatusPublished, Price: 500}, 10)
	rented := seedEpisodeWithPages(t, env, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEPOSF", Title: "Rented", Status: testutil.EpisodeStatusPublished, Price: 500}, 10)
	draft := seedEpisodeWithPages(t, env, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEPOSG", Title: "Draft", Status: testutil.EpisodeStatusDraft}, 10)
	foreignSeries := env.PG.SeedSeries(t, otherTenant.ID, testutil.SeriesSeed{PublicID: "SERIESPOSD", Title: "Foreign", Published: true})
	foreign := seedEpisodeWithPages(t, env, otherTenant.ID, foreignSeries.ID, testutil.EpisodeSeed{PublicID: "EPISODEPOSH", Title: "Foreign", Status: testutil.EpisodeStatusPublished}, 10)
	ticketID := uuid.Must(uuid.NewV7())
	if _, err := env.PG.DB.ExecContext(context.Background(), `
		INSERT INTO access_tickets (id, tenant_id, public_id, episode_id, user_id, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, ticketID, tenant.ID, "TICKETPOS001", rented.ID, member.ID, time.Now().Add(time.Hour)); err != nil {
		t.Fatalf("seed access ticket: %v", err)
	}

	client := env.episodeReadClient()
	token := tokenFor(t, tenant, member)

	for _, episode := range []testutil.Episode{free, rented} {
		if _, err := client.SaveReadingPosition(context.Background(), saveReadingPositionRequest(tenant, episode.PublicID, 5, token)); err != nil {
			t.Fatalf("SaveReadingPosition %s: %v", episode.PublicID, err)
		}
	}
	for _, publicID := range []string{paid.PublicID, draft.PublicID, foreign.PublicID, "MISSINGPOS"} {
		_, err := client.SaveReadingPosition(context.Background(), saveReadingPositionRequest(tenant, publicID, 5, token))
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("SaveReadingPosition %s code = %v, want not_found (err=%v)", publicID, connect.CodeOf(err), err)
		}
	}

	// The rental runs out while the position stays in the table: the reader can
	// no longer open the episode, so there is nothing to resume.
	if _, err := env.PG.DB.ExecContext(context.Background(),
		"UPDATE access_tickets SET expires_at = $1 WHERE id = $2", time.Now().Add(-time.Minute), ticketID,
	); err != nil {
		t.Fatalf("expire access ticket: %v", err)
	}
	expired, err := client.GetMyReadingPosition(context.Background(), getReadingPositionRequest(tenant, rented.PublicID, token))
	if err != nil {
		t.Fatalf("GetMyReadingPosition after the rental expired: %v", err)
	}
	if expired.Msg.Position != nil {
		t.Fatalf("expired rental position = %+v, want none", expired.Msg.Position)
	}
	still, err := client.GetMyReadingPosition(context.Background(), getReadingPositionRequest(tenant, free.PublicID, token))
	if err != nil {
		t.Fatalf("GetMyReadingPosition: %v", err)
	}
	if still.Msg.Position.GetPageIndex() != 5 {
		t.Fatalf("free episode position = %+v, want page 5", still.Msg.Position)
	}
}

func TestDBReadingPositionsAreMemberScopedByRLS(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTPOSD", "position-d.example.com", "Position D")
	first := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERPOSD", "member-position-d@example.com", "Member D", "tenant_member")
	second := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERPOSE", "member-position-e@example.com", "Member E", "tenant_member")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESPOSE", Title: "Public series", Published: true})
	episode := seedEpisodeWithPages(t, env, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEPOSI", Title: "Free", Status: testutil.EpisodeStatusPublished}, 10)
	client := env.episodeReadClient()

	if _, err := client.SaveReadingPosition(context.Background(), saveReadingPositionRequest(tenant, episode.PublicID, 7, tokenFor(t, tenant, first))); err != nil {
		t.Fatalf("SaveReadingPosition as the first member: %v", err)
	}

	otherRead, err := client.GetMyReadingPosition(context.Background(), getReadingPositionRequest(tenant, episode.PublicID, tokenFor(t, tenant, second)))
	if err != nil {
		t.Fatalf("GetMyReadingPosition as the second member: %v", err)
	}
	if otherRead.Msg.Position != nil {
		t.Fatalf("second member position = %+v, want none", otherRead.Msg.Position)
	}

	env.withTenantConn(t, tenant.ID, func(ctx context.Context, conn *sql.Conn) {
		if _, err := conn.ExecContext(ctx, "SELECT set_config('app.current_user_id', $1, false)", second.ID.String()); err != nil {
			t.Fatalf("set app.current_user_id: %v", err)
		}
		var visible int
		if err := conn.QueryRowContext(ctx, "SELECT COUNT(*) FROM episode_reading_positions").Scan(&visible); err != nil {
			t.Fatalf("count reading positions: %v", err)
		}
		if visible != 0 {
			t.Fatalf("other member visible reading positions = %d, want 0", visible)
		}
		created, err := conn.ExecContext(ctx,
			"INSERT INTO episode_reading_positions (tenant_id, user_id, episode_id, page_index, page_count) VALUES ($1, $2, $3, 1, 10)",
			tenant.ID, first.ID, episode.ID,
		)
		if err == nil {
			t.Fatalf("write a first member position as another member succeeded: %#v", created)
		}
		updated, err := conn.ExecContext(ctx,
			"UPDATE episode_reading_positions SET page_index = 0 WHERE tenant_id = $1 AND user_id = $2 AND episode_id = $3",
			tenant.ID, first.ID, episode.ID,
		)
		if err != nil {
			t.Fatalf("attempt to update another member position: %v", err)
		}
		if changed, err := updated.RowsAffected(); err != nil {
			t.Fatalf("other member update rows affected: %v", err)
		} else if changed != 0 {
			t.Fatalf("other member updated %d reading positions, want 0", changed)
		}
	})
}

func TestDBReadingPositionsAreTenantScopedByRLS(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant, otherTenant := env.seedTwoTenants(t)
	member := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERPOSF", "member-position-f@example.com", "Member F", "tenant_member")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESPOSF", Title: "Public series", Published: true})
	episode := seedEpisodeWithPages(t, env, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEPOSJ", Title: "Free", Status: testutil.EpisodeStatusPublished}, 10)
	client := env.episodeReadClient()

	if _, err := client.SaveReadingPosition(context.Background(), saveReadingPositionRequest(tenant, episode.PublicID, 3, tokenFor(t, tenant, member))); err != nil {
		t.Fatalf("SaveReadingPosition: %v", err)
	}

	// The other tenant's connection carries the same member id, which is the
	// only thing member isolation would match on: the tenant half of the policy
	// is what has to hide the row.
	env.withTenantConn(t, otherTenant.ID, func(ctx context.Context, conn *sql.Conn) {
		if _, err := conn.ExecContext(ctx, "SELECT set_config('app.current_user_id', $1, false)", member.ID.String()); err != nil {
			t.Fatalf("set app.current_user_id: %v", err)
		}
		var visible int
		if err := conn.QueryRowContext(ctx, "SELECT COUNT(*) FROM episode_reading_positions").Scan(&visible); err != nil {
			t.Fatalf("count reading positions: %v", err)
		}
		if visible != 0 {
			t.Fatalf("other tenant visible reading positions = %d, want 0", visible)
		}
	})
}

func TestDBSeriesProgressReturnsTheLastOpenedEpisodeAndItsFinishedState(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTPOSE", "position-e.example.com", "Position E")
	member := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERPOSG", "member-position-g@example.com", "Member G", "tenant_member")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESPOSG", Title: "Public series", Published: true})
	other := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESPOSH", Title: "Another series", Published: true})
	first := seedEpisodeWithPages(t, env, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEPOSK", Title: "Episode 1", Status: testutil.EpisodeStatusPublished}, 10)
	second := seedEpisodeWithPages(t, env, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEPOSL", Title: "Episode 2", Status: testutil.EpisodeStatusPublished}, 10)
	otherEpisode := seedEpisodeWithPages(t, env, tenant.ID, other.ID, testutil.EpisodeSeed{PublicID: "EPISODEPOSM", Title: "Elsewhere", Status: testutil.EpisodeStatusPublished}, 10)
	client := env.episodeReadClient()
	token := tokenFor(t, tenant, member)

	empty, err := client.GetMySeriesProgress(context.Background(), seriesProgressRequest(tenant, series.PublicID, token))
	if err != nil {
		t.Fatalf("GetMySeriesProgress before reading: %v", err)
	}
	if empty.Msg.Progress != nil {
		t.Fatalf("progress before reading = %+v, want none", empty.Msg.Progress)
	}

	for _, save := range []struct {
		publicID  string
		pageIndex int32
	}{
		{first.PublicID, 9},
		{otherEpisode.PublicID, 1},
		{second.PublicID, 6},
	} {
		if _, err := client.SaveReadingPosition(context.Background(), saveReadingPositionRequest(tenant, save.publicID, save.pageIndex, token)); err != nil {
			t.Fatalf("SaveReadingPosition %s: %v", save.publicID, err)
		}
	}

	progress, err := client.GetMySeriesProgress(context.Background(), seriesProgressRequest(tenant, series.PublicID, token))
	if err != nil {
		t.Fatalf("GetMySeriesProgress: %v", err)
	}
	if got := progress.Msg.Progress.GetEpisode().GetPublicId(); got != second.PublicID {
		t.Fatalf("progress episode = %q, want the last opened %q", got, second.PublicID)
	}
	if got := progress.Msg.Progress.GetPosition().GetPageIndex(); got != 6 {
		t.Fatalf("progress page_index = %d, want 6", got)
	}
	if progress.Msg.Progress.GetIsFinished() {
		t.Fatal("is_finished = true before the episode was marked as read")
	}

	if _, err := client.MarkEpisodeAsRead(context.Background(), episodeReadRequest(tenant, second.PublicID, token)); err != nil {
		t.Fatalf("MarkEpisodeAsRead: %v", err)
	}
	finished, err := client.GetMySeriesProgress(context.Background(), seriesProgressRequest(tenant, series.PublicID, token))
	if err != nil {
		t.Fatalf("GetMySeriesProgress after finishing: %v", err)
	}
	if !finished.Msg.Progress.GetIsFinished() {
		t.Fatal("is_finished = false after the episode was marked as read")
	}
}

func TestDBSeriesProgressSkipsAnEpisodeTheReaderCanNoLongerOpen(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTPOSF", "position-f.example.com", "Position F")
	member := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERPOSH", "member-position-h@example.com", "Member H", "tenant_member")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESPOSI", Title: "Public series", Published: true})
	free := seedEpisodeWithPages(t, env, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEPOSN", Title: "Episode 1", Status: testutil.EpisodeStatusPublished}, 10)
	rented := seedEpisodeWithPages(t, env, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEPOSO", Title: "Episode 2", Status: testutil.EpisodeStatusPublished, Price: 500}, 10)
	ticketID := uuid.Must(uuid.NewV7())
	if _, err := env.PG.DB.ExecContext(context.Background(), `
		INSERT INTO access_tickets (id, tenant_id, public_id, episode_id, user_id, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, ticketID, tenant.ID, "TICKETPOS002", rented.ID, member.ID, time.Now().Add(time.Hour)); err != nil {
		t.Fatalf("seed access ticket: %v", err)
	}
	client := env.episodeReadClient()
	token := tokenFor(t, tenant, member)

	for _, save := range []struct {
		publicID  string
		pageIndex int32
	}{
		{free.PublicID, 2},
		{rented.PublicID, 8},
	} {
		if _, err := client.SaveReadingPosition(context.Background(), saveReadingPositionRequest(tenant, save.publicID, save.pageIndex, token)); err != nil {
			t.Fatalf("SaveReadingPosition %s: %v", save.publicID, err)
		}
	}
	if _, err := env.PG.DB.ExecContext(context.Background(),
		"UPDATE access_tickets SET expires_at = $1 WHERE id = $2", time.Now().Add(-time.Minute), ticketID,
	); err != nil {
		t.Fatalf("expire access ticket: %v", err)
	}

	progress, err := client.GetMySeriesProgress(context.Background(), seriesProgressRequest(tenant, series.PublicID, token))
	if err != nil {
		t.Fatalf("GetMySeriesProgress: %v", err)
	}
	if got := progress.Msg.Progress.GetEpisode().GetPublicId(); got != free.PublicID {
		t.Fatalf("progress episode = %q, want the episode before the expired rental %q", got, free.PublicID)
	}
}
