package dbtest

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/publira/publira/server/internal/dayroll"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/freewindows"
	"github.com/publira/publira/server/internal/publishepisodes"
	"github.com/publira/publira/server/internal/tenantday"
	"github.com/publira/publira/server/internal/testutil"
)

// publira_ticker is the one application role the baseline seed grants table by
// table instead of handing it the whole schema, so nothing but a test that runs
// the real jobs on that connection says whether the list is still complete. The
// jobs log their failures and return nothing, which is why each case asserts on
// the rows the run was supposed to write: a missing grant leaves them behind.

func TestTickerRoleRunsPublishEpisodes(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "TICKTENANT01", "ticker.example.com", "Ticker Tenant")
	admin := pg.SeedTenantAdmin(t, tenant.ID, "TICKADMIN001", "ticker-admin@example.com", "Ticker Admin")
	follower := pg.SeedEndUser(t, tenant.ID, "TICKREADER01", "ticker-reader@example.com", "Ticker Reader")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "TICKSERIES01", Title: "Ticker Series", Published: true})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID:    "TICKEPISODE1",
		Title:       "Ticker Episode",
		Status:      testutil.EpisodeStatusScheduled,
		ScheduledAt: time.Now().Add(-time.Minute),
	})
	if _, err := pg.DB.ExecContext(ctx,
		"INSERT INTO series_follows (tenant_id, user_id, series_id) VALUES ($1, $2, $3)",
		tenant.ID, follower.ID, series.ID,
	); err != nil {
		t.Fatalf("insert series follow: %v", err)
	}

	ticker := pg.OpenTickerDB(t)
	publishepisodes.New(ticker, dbmodels.New(ticker), nil, discardLogger(), 0).RunOnce(ctx)

	var status string
	if err := pg.DB.QueryRowContext(ctx,
		"SELECT status FROM episode_listings WHERE episode_id = $1", episode.ID,
	).Scan(&status); err != nil {
		t.Fatalf("read listing status: %v", err)
	}
	if status != "published" {
		t.Fatalf("listing status = %q, want published", status)
	}

	for _, recipient := range []struct {
		name   string
		userID uuid.UUID
	}{
		{name: "follower", userID: follower.ID},
		{name: "tenant admin", userID: admin.ID},
	} {
		var notifications int
		if err := pg.DB.QueryRowContext(ctx,
			"SELECT count(*) FROM notifications WHERE user_id = $1 AND subject_key = $2",
			recipient.userID, "episode:"+episode.PublicID,
		).Scan(&notifications); err != nil {
			t.Fatalf("count %s notifications: %v", recipient.name, err)
		}
		if notifications != 1 {
			t.Fatalf("%s notifications = %d, want 1", recipient.name, notifications)
		}
	}

	var events int
	if err := pg.DB.QueryRowContext(ctx,
		"SELECT count(*) FROM outbox_events WHERE event_type = 'member_push_notification'",
	).Scan(&events); err != nil {
		t.Fatalf("count outbox events: %v", err)
	}
	if events != 1 {
		t.Fatalf("member push outbox events = %d, want 1", events)
	}
}

func TestTickerRoleRunsApplyFreeWindows(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "TICKTENANT02", "windows.example.com", "Window Tenant")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "TICKSERIES02", Title: "Window Series", Published: true})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "TICKEPISODE2",
		Title:    "Window Episode",
		Price:    500,
		Status:   testutil.EpisodeStatusPublished,
	})
	windowID := pg.SeedEpisodeFreeWindow(t, tenant.ID, episode.ID, time.Now().Add(-time.Hour), time.Now().Add(time.Hour))

	ticker := pg.OpenTickerDB(t)
	freewindows.New(dbmodels.New(ticker), nil, discardLogger()).RunOnce(ctx)

	var startApplied sql.NullTime
	if err := pg.DB.QueryRowContext(ctx,
		"SELECT start_revalidated_at FROM episode_free_windows WHERE id = $1", windowID,
	).Scan(&startApplied); err != nil {
		t.Fatalf("read free window: %v", err)
	}
	if !startApplied.Valid {
		t.Fatal("start_revalidated_at is still null, want the passed boundary recorded")
	}
}

func TestTickerRoleRunsRollTenantDay(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "TICKTENANT03", "dayroll.example.com", "Day Tenant")

	ticker := pg.OpenTickerDB(t)
	lister := func(ctx context.Context) ([]tenantday.Tenant, error) {
		return tenantday.List(ctx, ticker)
	}

	tenants, err := lister(ctx)
	if err != nil {
		t.Fatalf("list tenants as the ticker role: %v", err)
	}
	found := false
	for _, listed := range tenants {
		if listed.ID == tenant.ID {
			found = true
		}
	}
	if !found {
		t.Fatalf("listed tenants = %v, want the seeded tenant %s", tenants, tenant.ID)
	}

	// The drop itself needs no grant — it is an HTTP call to the web apps — so
	// the listing above is the whole of this job's database access.
	dayroll.New(lister, nil, discardLogger()).RunOnce(ctx, time.Now())
}

// TestTickerRoleWritesPublishFailureNotifications covers the grants of the path
// a successful run never takes: the operator fan-out publish-episodes files when
// an episode fails on its last attempt.
func TestTickerRoleWritesPublishFailureNotifications(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	operator := pg.SeedPlatformOperator(t, "TICKOPERAT01", "ticker-operator@example.com", "Ticker Operator")

	ticker := pg.OpenTickerDB(t)
	queries := dbmodels.New(ticker)

	operators, err := queries.ListPlatformOperatorIDs(ctx)
	if err != nil {
		t.Fatalf("ListPlatformOperatorIDs as the ticker role: %v", err)
	}
	if len(operators) != 1 || operators[0] != operator.ID {
		t.Fatalf("operator ids = %v, want [%s]", operators, operator.ID)
	}

	if _, err := queries.CreatePlatformNotification(ctx, dbmodels.CreatePlatformNotificationParams{
		ID:               uuid.Must(uuid.NewV7()),
		PlatformUserID:   operator.ID,
		NotificationType: "episode_publish_failed",
		SubjectKey:       "episode:TICKEPISODE3",
		Payload:          json.RawMessage(`{"episode_id":"TICKEPISODE3"}`),
	}); err != nil {
		t.Fatalf("CreatePlatformNotification as the ticker role: %v", err)
	}
}

// TestTickerRoleCannotReachAnotherDomain is the other half of the per-table
// grants: a table none of the three jobs touches stays out of reach, so the
// list in the seed is a boundary rather than a formality.
func TestTickerRoleCannotReachAnotherDomain(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	ticker := pg.OpenTickerDB(t)
	var count int
	err := ticker.QueryRowContext(ctx, "SELECT count(*) FROM audit_logs").Scan(&count)
	if err == nil {
		t.Fatalf("reading audit_logs as the ticker role returned %d rows, want a permission denied error", count)
	}
	// The SQLSTATE rather than any error: a dropped connection or a table that
	// went away would otherwise pass for a grant that is no longer there.
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != insufficientPrivilegeCode {
		t.Fatalf("read audit_logs error = %v, want SQLSTATE %s", err, insufficientPrivilegeCode)
	}
}

// insufficientPrivilegeCode is the SQLSTATE PostgreSQL reports for a relation
// the connected role holds no privilege on.
const insufficientPrivilegeCode = "42501"

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}
