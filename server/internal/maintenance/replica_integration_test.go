package maintenance

import (
	"context"
	"database/sql"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	semconv "go.opentelemetry.io/otel/semconv/v1.43.0"

	"github.com/publira/publira/server/internal/sqldb"
	"github.com/publira/publira/server/internal/testutil"
)

// A rebuild given a replica writes the rows a rebuild on the primary alone
// writes, however far behind the standby is when it starts: one that catches
// up within the wait answers the reads of content_events, and one that does
// not leaves them to the primary. Either way nothing it reads is older than
// what the primary had committed when the rebuild began.
func TestRebuildsOnAReplicaWriteThePrimarysRows(t *testing.T) {
	pg := testutil.StartReplicatedPostgres(t)
	ctx := context.Background()

	spans := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(spans))
	previous := otel.GetTracerProvider()
	otel.SetTracerProvider(provider)
	t.Cleanup(func() {
		otel.SetTracerProvider(previous)
		_ = provider.Shutdown(context.Background())
	})
	primary := openInstrumented(t, pg.ContentStatsURL)
	replica := openInstrumented(t, pg.StandbyContentStatsURL)
	standbyPort := portOf(t, pg.StandbyContentStatsURL)

	tenant := pg.SeedTenant(t, "REPLICAREBLD", "replica-rebuild.example.com", "Replica Rebuild")
	setTenantTimeZone(t, pg.DB, tenant.ID, "UTC")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "REPLICASER01"})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "REPLICAEP001"})
	readers := []uuid.UUID{
		pg.SeedEndUser(t, tenant.ID, "REPLICAUSR01", "first@replica-rebuild.example.com", "First Reader").ID,
		pg.SeedEndUser(t, tenant.ID, "REPLICAUSR02", "second@replica-rebuild.example.com", "Second Reader").ID,
	}
	day := utcDate(time.Now()).AddDate(0, 0, -1)
	bucket := int64(0)
	view := func(t *testing.T, reader uuid.UUID) {
		t.Helper()
		bucket++
		if _, err := pg.DB.ExecContext(ctx, `
			INSERT INTO content_events (id, tenant_id, event_type, user_id, series_id, episode_id, debounce_bucket, occurred_at)
			VALUES ($1, $2, 'episode_view', $3, $4, $5, $6, $7)
		`, uuid.Must(uuid.NewV7()), tenant.ID, reader, series.ID, episode.ID, bucket, day.Add(time.Duration(bucket)*time.Minute)); err != nil {
			t.Fatalf("insert view: %v", err)
		}
	}
	view(t, readers[0])
	pg.WaitForReplay(t)

	// rebuild runs the two rebuilds that read content_events on deps and
	// answers what they wrote, and the ports the reads of content_events were
	// answered on.
	rebuild := func(t *testing.T, deps Deps) (rebuilt string, readOn []int64) {
		t.Helper()
		before := len(spans.Ended())
		if err := (ContentStatsAggregation{Date: day}).Run(ctx, deps); err != nil {
			t.Fatalf("ContentStatsAggregation: %v", err)
		}
		if err := (RecommendFeatureBuild{Date: day}).Run(ctx, deps); err != nil {
			t.Fatalf("RecommendFeatureBuild: %v", err)
		}
		for _, span := range spans.Ended()[before:] {
			var text string
			var port int64
			for _, kv := range span.Attributes() {
				switch kv.Key {
				case semconv.DBQueryTextKey:
					text = kv.Value.AsString()
				case semconv.ServerPortKey:
					port = kv.Value.AsInt64()
				}
			}
			if strings.Contains(text, "FROM content_events") {
				readOn = append(readOn, port)
			}
		}
		return rebuiltRows(t, pg.DB, tenant.ID, day), readOn
	}
	onPrimary := func(t *testing.T) string {
		t.Helper()
		rows, _ := rebuild(t, Deps{DB: primary, Logger: discardLogger()})
		return rows
	}
	withReplica := Deps{DB: primary, Replica: replica, Logger: discardLogger()}

	t.Run("a standby that catches up within the wait answers the reads", func(t *testing.T) {
		pg.PauseReplay(t)
		view(t, readers[1])
		// The superuser resumes replay a second into the rebuild, well inside
		// the wait, from a goroutine that must not fail the test itself.
		standby, err := sql.Open("pgx", pg.StandbyURL)
		if err != nil {
			t.Fatalf("open the standby: %v", err)
		}
		t.Cleanup(func() { _ = standby.Close() })
		resumed := make(chan error, 1)
		go func() {
			time.Sleep(time.Second)
			_, err := standby.ExecContext(context.Background(), "SELECT pg_wal_replay_resume()")
			resumed <- err
		}()
		got, readOn := rebuild(t, withReplica)
		if err := <-resumed; err != nil {
			t.Fatalf("resume replay: %v", err)
		}
		if len(readOn) == 0 || slices.ContainsFunc(readOn, func(port int64) bool { return port != standbyPort }) {
			t.Fatalf("content_events was read on ports %v, want the standby's (%d) alone", readOn, standbyPort)
		}
		if want := onPrimary(t); got != want {
			t.Fatalf("rows rebuilt on the replica:\n%s\nwant the primary's:\n%s", got, want)
		}
	})

	t.Run("a standby still behind after the wait leaves the reads to the primary", func(t *testing.T) {
		pg.PauseReplay(t)
		view(t, readers[0])
		view(t, readers[1])
		got, readOn := rebuild(t, withReplica)
		if len(readOn) == 0 || slices.Contains(readOn, standbyPort) {
			t.Fatalf("content_events was read on ports %v, want none on the lagging standby (%d)", readOn, standbyPort)
		}
		if want := onPrimary(t); got != want {
			t.Fatalf("rows rebuilt beside a lagging replica:\n%s\nwant the primary's:\n%s", got, want)
		}
	})
}

func openInstrumented(t *testing.T, url string) *sql.DB {
	t.Helper()
	db, err := sqldb.Open(url)
	if err != nil {
		t.Fatalf("open %s: %v", url, err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func portOf(t *testing.T, raw string) int64 {
	t.Helper()
	parsed, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("parse %s: %v", raw, err)
	}
	port, err := strconv.ParseInt(parsed.Port(), 10, 64)
	if err != nil {
		t.Fatalf("port of %s: %v", raw, err)
	}
	return port
}

// rebuiltRows renders what the two rebuilds keep for tenant and day, leaving
// out the ids and the instants each run stamps afresh.
func rebuiltRows(t *testing.T, db *sql.DB, tenantID uuid.UUID, day time.Time) string {
	t.Helper()
	var b strings.Builder
	for _, query := range []string{
		`SELECT entity_type || ' ' || entity_id || ' ' || view_count || ' ' || unique_viewer_count || ' ' ||
			member_view_count || ' ' || purchase_count || ' ' || complete_count || ' ' || rating_count || ' ' ||
			rating_sum || ' ' || favorite_count || ' ' || comment_count
		 FROM content_daily_stats WHERE tenant_id = $1 AND stat_date = $2 ORDER BY 1`,
		`SELECT 'item ' || entity_type || ' ' || entity_id || ' ' || features::text || ' ' || feature_version
		 FROM item_recommend_features WHERE tenant_id = $1 AND $2::date IS NOT NULL ORDER BY 1`,
		`SELECT 'user ' || user_id || ' ' || features::text || ' ' || feature_version
		 FROM user_recommend_features WHERE tenant_id = $1 AND $2::date IS NOT NULL ORDER BY 1`,
	} {
		rows, err := db.QueryContext(context.Background(), query, tenantID, day)
		if err != nil {
			t.Fatalf("read the rebuilt rows: %v", err)
		}
		for rows.Next() {
			var line string
			if err := rows.Scan(&line); err != nil {
				t.Fatalf("scan a rebuilt row: %v", err)
			}
			b.WriteString(line + "\n")
		}
		if err := rows.Close(); err != nil {
			t.Fatalf("read the rebuilt rows: %v", err)
		}
	}
	if b.Len() == 0 {
		t.Fatal("the rebuilds wrote nothing")
	}
	return b.String()
}
