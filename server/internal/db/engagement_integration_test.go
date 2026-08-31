package dbmodels_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/testutil"
)

// engagementSeed is one tenant's catalog + user, enough to insert content_events.
type engagementSeed struct {
	tenantID  uuid.UUID
	userID    uuid.UUID
	seriesID  uuid.UUID
	episodeID uuid.UUID
}

func seedEngagementCatalog(t *testing.T, ctx context.Context, db *sql.DB, suffix string) engagementSeed {
	t.Helper()
	// public_id is varchar(12); keep the suffix short and unique per call.
	tenant := mustInsertTenant(t, ctx, db,
		"TNT"+suffix, suffix+".example.com", "admin-"+suffix+".example.com", "Tenant "+suffix)
	user := mustInsertUser(t, ctx, db, tenant, "USR"+suffix, "user-"+suffix+"@example.com", "User "+suffix)
	seriesID, episodeID := mustInsertSeriesAndEpisode(t, ctx, db, tenant, "SER"+suffix, "EP"+suffix)
	return engagementSeed{
		tenantID:  tenant,
		userID:    user,
		seriesID:  seriesID,
		episodeID: episodeID,
	}
}

func mustInsertSeriesAndEpisode(t *testing.T, ctx context.Context, db *sql.DB, tenantID uuid.UUID, seriesPublicID, episodePublicID string) (uuid.UUID, uuid.UUID) {
	t.Helper()
	seriesID, err := uuid.NewV7()
	if err != nil {
		t.Fatalf("uuid: %v", err)
	}
	episodeID, err := uuid.NewV7()
	if err != nil {
		t.Fatalf("uuid: %v", err)
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO series (id, tenant_id, public_id, title, is_published)
		VALUES ($1, $2, $3, $4, false)
	`, seriesID, tenantID, seriesPublicID, seriesPublicID+" series")
	if err != nil {
		t.Fatalf("insert series %s: %v", seriesPublicID, err)
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO episodes (id, series_id, public_id, title, order_index, tenant_id)
		VALUES ($1, $2, $3, $4, 1, $5)
	`, episodeID, seriesID, episodePublicID, episodePublicID, tenantID)
	if err != nil {
		t.Fatalf("insert episode %s: %v", episodePublicID, err)
	}
	return seriesID, episodeID
}

func withAdminTenant(t *testing.T, pg *testutil.PostgresEnv, tenantID uuid.UUID, fn func(ctx context.Context, conn *sql.Conn)) {
	t.Helper()
	db := pg.OpenAdminDB(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	conn, err := db.Conn(ctx)
	if err != nil {
		t.Fatalf("admin conn: %v", err)
	}
	defer func() { _ = conn.Close() }()
	if _, err := conn.ExecContext(ctx, "SELECT set_config('app.current_tenant_id', $1, false)", tenantID.String()); err != nil {
		t.Fatalf("set app.current_tenant_id: %v", err)
	}
	fn(ctx, conn)
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23505"
	}
	return err != nil && strings.Contains(err.Error(), "duplicate key")
}

// restrict_violation (23001) is what PostgreSQL raises for ON DELETE RESTRICT.
// NO ACTION would be foreign_key_violation (23503) instead.
func isRestrictViolation(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23001"
	}
	return err != nil && strings.Contains(err.Error(), "violates RESTRICT")
}

func isCheckViolation(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23514"
	}
	return err != nil && strings.Contains(err.Error(), "violates check constraint")
}

func checkName(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.ConstraintName
	}
	return ""
}

func nullUUID(id uuid.UUID) uuid.NullUUID {
	return uuid.NullUUID{UUID: id, Valid: true}
}

func emptyPayload() json.RawMessage {
	return json.RawMessage(`{}`)
}

func TestContentEventsRLSHidesOtherTenant(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	a := seedEngagementCatalog(t, ctx, pg.DB, "AAAA01")
	b := seedEngagementCatalog(t, ctx, pg.DB, "BBBB02")
	queries := dbmodels.New(pg.DB)

	mine, err := queries.InsertDebouncedEpisodeViewEvent(ctx, dbmodels.InsertDebouncedEpisodeViewEventParams{
		ID:             uuid.Must(uuid.NewV7()),
		TenantID:       a.tenantID,
		UserID:         nullUUID(a.userID),
		SeriesID:       a.seriesID,
		EpisodeID:      a.episodeID,
		DebounceBucket: 100,
		Payload:        emptyPayload(),
		OccurredAt:     time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("insert tenant A event: %v", err)
	}
	theirs, err := queries.InsertDebouncedEpisodeViewEvent(ctx, dbmodels.InsertDebouncedEpisodeViewEventParams{
		ID:             uuid.Must(uuid.NewV7()),
		TenantID:       b.tenantID,
		UserID:         nullUUID(b.userID),
		SeriesID:       b.seriesID,
		EpisodeID:      b.episodeID,
		DebounceBucket: 100,
		Payload:        emptyPayload(),
		OccurredAt:     time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("insert tenant B event: %v", err)
	}

	withAdminTenant(t, pg, a.tenantID, func(ctx context.Context, conn *sql.Conn) {
		var visible int
		if err := conn.QueryRowContext(ctx, "SELECT count(*) FROM content_events").Scan(&visible); err != nil {
			t.Fatalf("count content_events: %v", err)
		}
		if visible != 1 {
			t.Fatalf("visible events = %d, want 1", visible)
		}

		var eventType string
		err := conn.QueryRowContext(ctx, "SELECT event_type FROM content_events WHERE id = $1", theirs.ID).Scan(&eventType)
		if err == nil {
			t.Fatalf("read tenant B event as tenant A: got %q", eventType)
		}
		if !errors.Is(err, sql.ErrNoRows) {
			t.Fatalf("read tenant B event error = %v, want sql.ErrNoRows", err)
		}

		if err := conn.QueryRowContext(ctx, "SELECT event_type FROM content_events WHERE id = $1", mine.ID).Scan(&eventType); err != nil {
			t.Fatalf("read own event: %v", err)
		}

		_, err = conn.ExecContext(ctx, `
			INSERT INTO content_events (
				id, tenant_id, event_type, user_id, series_id, episode_id, debounce_bucket, payload
			) VALUES ($1, $2, 'episode_view', $3, $4, $5, 1, '{}'::jsonb)
		`, uuid.Must(uuid.NewV7()), b.tenantID, b.userID, b.seriesID, b.episodeID)
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "42501" {
			t.Fatalf("insert for another tenant error = %v, want SQLSTATE 42501", err)
		}
	})
}

func TestContentEventsSourceUniqueIsIdempotent(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	seed := seedEngagementCatalog(t, ctx, pg.DB, "SRC00001")
	queries := dbmodels.New(pg.DB)
	sourceID := uuid.Must(uuid.NewV7())

	first, err := queries.InsertProjectedSourceEvent(ctx, dbmodels.InsertProjectedSourceEventParams{
		ID:          uuid.Must(uuid.NewV7()),
		TenantID:    seed.tenantID,
		EventType:   "purchase",
		UserID:      seed.userID,
		SeriesID:    seed.seriesID,
		EpisodeID:   seed.episodeID,
		SourceTable: "purchases",
		SourceID:    sourceID,
		Payload:     emptyPayload(),
		OccurredAt:  time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("first purchase projection: %v", err)
	}

	_, err = queries.InsertProjectedSourceEvent(ctx, dbmodels.InsertProjectedSourceEventParams{
		ID:          uuid.Must(uuid.NewV7()),
		TenantID:    seed.tenantID,
		EventType:   "purchase",
		UserID:      seed.userID,
		SeriesID:    seed.seriesID,
		EpisodeID:   seed.episodeID,
		SourceTable: "purchases",
		SourceID:    sourceID,
		Payload:     emptyPayload(),
		OccurredAt:  time.Now().UTC(),
	})
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("duplicate projection error = %v, want sql.ErrNoRows", err)
	}

	// The unique index itself must also reject a raw INSERT (no ON CONFLICT).
	_, err = pg.DB.ExecContext(ctx, `
		INSERT INTO content_events (
			id, tenant_id, event_type, user_id, series_id, episode_id,
			source_table, source_id, payload
		) VALUES ($1, $2, 'purchase', $3, $4, $5, 'purchases', $6, '{}'::jsonb)
	`, uuid.Must(uuid.NewV7()), seed.tenantID, seed.userID, seed.seriesID, seed.episodeID, sourceID)
	if !isUniqueViolation(err) {
		t.Fatalf("raw duplicate source insert error = %v, want unique_violation", err)
	}

	var count int
	if err := pg.DB.QueryRowContext(ctx, `
		SELECT count(*) FROM content_events
		WHERE tenant_id = $1 AND source_table = 'purchases' AND source_id = $2
	`, seed.tenantID, sourceID).Scan(&count); err != nil {
		t.Fatalf("count projections: %v", err)
	}
	if count != 1 {
		t.Fatalf("projected rows = %d, want 1", count)
	}
	if first.EventType != "purchase" {
		t.Fatalf("first event_type = %q, want purchase", first.EventType)
	}
}

func TestContentEventsEpisodeViewDebounceUnique(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	seed := seedEngagementCatalog(t, ctx, pg.DB, "DEB00001")
	queries := dbmodels.New(pg.DB)
	const bucket int64 = 20260815000

	first, err := queries.InsertDebouncedEpisodeViewEvent(ctx, dbmodels.InsertDebouncedEpisodeViewEventParams{
		ID:             uuid.Must(uuid.NewV7()),
		TenantID:       seed.tenantID,
		UserID:         nullUUID(seed.userID),
		SeriesID:       seed.seriesID,
		EpisodeID:      seed.episodeID,
		DebounceBucket: bucket,
		Payload:        emptyPayload(),
		OccurredAt:     time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("first episode_view: %v", err)
	}

	_, err = queries.InsertDebouncedEpisodeViewEvent(ctx, dbmodels.InsertDebouncedEpisodeViewEventParams{
		ID:             uuid.Must(uuid.NewV7()),
		TenantID:       seed.tenantID,
		UserID:         nullUUID(seed.userID),
		SeriesID:       seed.seriesID,
		EpisodeID:      seed.episodeID,
		DebounceBucket: bucket,
		Payload:        emptyPayload(),
		OccurredAt:     time.Now().UTC(),
	})
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("same-bucket insert error = %v, want sql.ErrNoRows", err)
	}

	next, err := queries.InsertDebouncedEpisodeViewEvent(ctx, dbmodels.InsertDebouncedEpisodeViewEventParams{
		ID:             uuid.Must(uuid.NewV7()),
		TenantID:       seed.tenantID,
		UserID:         nullUUID(seed.userID),
		SeriesID:       seed.seriesID,
		EpisodeID:      seed.episodeID,
		DebounceBucket: bucket + 1,
		Payload:        emptyPayload(),
		OccurredAt:     time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("next-bucket episode_view: %v", err)
	}
	if next.ID == first.ID {
		t.Fatal("next-bucket insert reused the first row id")
	}

	var count int
	if err := pg.DB.QueryRowContext(ctx, `
		SELECT count(*) FROM content_events
		WHERE tenant_id = $1 AND event_type = 'episode_view' AND episode_id = $2 AND debounce_bucket = $3
	`, seed.tenantID, seed.episodeID, bucket).Scan(&count); err != nil {
		t.Fatalf("count debounce bucket: %v", err)
	}
	if count != 1 {
		t.Fatalf("same-bucket rows = %d, want 1", count)
	}
}

func TestContentEventsExplainUsesExpectedIndexes(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	seed := seedEngagementCatalog(t, ctx, pg.DB, "EXP00001")
	queries := dbmodels.New(pg.DB)
	if _, err := queries.InsertDebouncedEpisodeViewEvent(ctx, dbmodels.InsertDebouncedEpisodeViewEventParams{
		ID:             uuid.Must(uuid.NewV7()),
		TenantID:       seed.tenantID,
		UserID:         nullUUID(seed.userID),
		SeriesID:       seed.seriesID,
		EpisodeID:      seed.episodeID,
		DebounceBucket: 1,
		Payload:        emptyPayload(),
		OccurredAt:     time.Now().UTC(),
	}); err != nil {
		t.Fatalf("seed event for explain: %v", err)
	}

	// Empty-or-tiny tables prefer seq scans. disable seqscan so the planner
	// has to pick the index the query was written against. That is the memo
	// for #589: these shapes stay index-eligible.
	cases := []struct {
		name  string
		query string
		index string
	}{
		{
			name:  "tenant occurred_at",
			query: `SELECT * FROM content_events WHERE tenant_id = $1 ORDER BY occurred_at DESC LIMIT 20`,
			index: "idx_content_events_tenant_occurred_at",
		},
		{
			name:  "tenant type occurred_at",
			query: `SELECT * FROM content_events WHERE tenant_id = $1 AND event_type = 'episode_view' ORDER BY occurred_at DESC LIMIT 20`,
			index: "idx_content_events_tenant_type_occurred_at",
		},
	}

	tx, err := pg.DB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SET LOCAL enable_seqscan = off"); err != nil {
		t.Fatalf("disable seqscan: %v", err)
	}

	for _, tc := range cases {
		rows, err := tx.QueryContext(ctx, "EXPLAIN "+tc.query, seed.tenantID)
		if err != nil {
			t.Fatalf("%s explain: %v", tc.name, err)
		}
		var plan strings.Builder
		for rows.Next() {
			var line string
			if err := rows.Scan(&line); err != nil {
				t.Fatalf("%s scan explain: %v", tc.name, err)
			}
			plan.WriteString(line)
			plan.WriteByte('\n')
		}
		if err := rows.Err(); err != nil {
			t.Fatalf("%s explain rows: %v", tc.name, err)
		}
		if err := rows.Close(); err != nil {
			t.Fatalf("%s close explain: %v", tc.name, err)
		}
		if !strings.Contains(plan.String(), tc.index) {
			t.Fatalf("%s plan did not use %s:\n%s", tc.name, tc.index, plan.String())
		}
	}
}

// The public recommendation list asks for the newest snapshot of one ranking
// key and entity type, so all three columns have to be in the index ahead of
// computed_at. With entity_type left out, the scan walks past every other
// entity type's snapshots before it can honour LIMIT 1.
func TestContentRankingSnapshotExplainUsesTenantKeyEntityIndex(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	seed := seedEngagementCatalog(t, ctx, pg.DB, "EXPRNK01")
	statDate := time.Now().UTC().Truncate(24 * time.Hour)
	if _, err := dbmodels.New(pg.DB).UpsertContentRankingSnapshot(ctx, dbmodels.UpsertContentRankingSnapshotParams{
		ID:               uuid.Must(uuid.NewV7()),
		TenantID:         seed.tenantID,
		RankingKey:       "weekly",
		PeriodStart:      statDate,
		PeriodEnd:        statDate.Add(6 * 24 * time.Hour),
		EntityType:       "series",
		Items:            json.RawMessage(`[{"entity_id":"` + seed.seriesID.String() + `","score":1,"rank":1}]`),
		AlgorithmVersion: 1,
		ComputedAt:       time.Now().UTC(),
	}); err != nil {
		t.Fatalf("seed snapshot for explain: %v", err)
	}

	tx, err := pg.DB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SET LOCAL enable_seqscan = off"); err != nil {
		t.Fatalf("disable seqscan: %v", err)
	}

	rows, err := tx.QueryContext(ctx, `
		EXPLAIN SELECT * FROM content_ranking_snapshots
		WHERE tenant_id = $1 AND ranking_key = 'weekly' AND entity_type = 'series'
		ORDER BY computed_at DESC LIMIT 1
	`, seed.tenantID)
	if err != nil {
		t.Fatalf("explain: %v", err)
	}
	var plan strings.Builder
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			t.Fatalf("scan explain: %v", err)
		}
		plan.WriteString(line)
		plan.WriteByte('\n')
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("explain rows: %v", err)
	}
	if err := rows.Close(); err != nil {
		t.Fatalf("close explain: %v", err)
	}

	const index = "idx_content_ranking_snapshots_tenant_key_computed"
	if !strings.Contains(plan.String(), index) {
		t.Fatalf("plan did not use %s:\n%s", index, plan.String())
	}
	// An index that stops before entity_type still shows up in the plan, so the
	// filter has to be gone from it too: a Filter line means rows are read and
	// discarded before LIMIT 1.
	if strings.Contains(plan.String(), "Filter:") {
		t.Fatalf("plan filters rows the index should have excluded:\n%s", plan.String())
	}
}

func TestContentEventsCompositeFKUsesSeriesTenantUnique(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	var (
		uniqueDef string
		fkDef     string
	)
	if err := pg.DB.QueryRowContext(ctx, `
		SELECT pg_get_constraintdef(oid)
		FROM pg_constraint
		WHERE conname = 'series_tenant_id_id_key'
	`).Scan(&uniqueDef); err != nil {
		t.Fatalf("series_tenant_id_id_key: %v", err)
	}
	if !strings.Contains(uniqueDef, "UNIQUE") || !strings.Contains(uniqueDef, "tenant_id") {
		t.Fatalf("series_tenant_id_id_key def = %q, want UNIQUE (tenant_id, id)", uniqueDef)
	}

	if err := pg.DB.QueryRowContext(ctx, `
		SELECT pg_get_constraintdef(oid)
		FROM pg_constraint
		WHERE conname = 'content_events_tenant_series_id_fkey'
	`).Scan(&fkDef); err != nil {
		t.Fatalf("content_events_tenant_series_id_fkey: %v", err)
	}
	if !strings.Contains(fkDef, "REFERENCES series(tenant_id, id)") {
		t.Fatalf("series composite FK def = %q, want REFERENCES series(tenant_id, id)", fkDef)
	}
	if !strings.Contains(fkDef, "ON DELETE RESTRICT") {
		t.Fatalf("series composite FK def = %q, want ON DELETE RESTRICT", fkDef)
	}

	a := seedEngagementCatalog(t, ctx, pg.DB, "FKA00001")
	b := seedEngagementCatalog(t, ctx, pg.DB, "FKB00002")

	// Same-tenant insert succeeds.
	if _, err := insertEpisodeView(ctx, pg.DB, a, a.userID, a.seriesID, a.episodeID, 1); err != nil {
		t.Fatalf("same-tenant insert: %v", err)
	}

	// Cross-tenant series must fail the composite FK.
	_, err := insertEpisodeView(ctx, pg.DB, a, a.userID, b.seriesID, a.episodeID, 2)
	if !isForeignKeyViolation(err) {
		t.Fatalf("cross-tenant series error = %v, want foreign_key_violation", err)
	}
	if !strings.Contains(err.Error(), "content_events_tenant_series_id_fkey") {
		t.Fatalf("cross-tenant series error = %v, want content_events_tenant_series_id_fkey", err)
	}
}

func TestContentEventsFKDeleteActions(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	restrictSeed := seedEngagementCatalog(t, ctx, pg.DB, "RST00001")
	if _, err := insertEpisodeView(ctx, pg.DB, restrictSeed, restrictSeed.userID, restrictSeed.seriesID, restrictSeed.episodeID, 1); err != nil {
		t.Fatalf("seed restrict event: %v", err)
	}

	_, err := pg.DB.ExecContext(ctx, `DELETE FROM series WHERE id = $1`, restrictSeed.seriesID)
	if !isRestrictViolation(err) {
		t.Fatalf("delete series error = %v, want restrict_violation (23001)", err)
	}
	if !strings.Contains(err.Error(), "content_events_tenant_series_id_fkey") {
		t.Fatalf("delete series error = %v, want content_events_tenant_series_id_fkey", err)
	}

	_, err = pg.DB.ExecContext(ctx, `DELETE FROM episodes WHERE id = $1`, restrictSeed.episodeID)
	if !isRestrictViolation(err) {
		t.Fatalf("delete episode error = %v, want restrict_violation (23001)", err)
	}
	if !strings.Contains(err.Error(), "content_events_tenant_episode_id_fkey") {
		t.Fatalf("delete episode error = %v, want content_events_tenant_episode_id_fkey", err)
	}

	cascadeSeed := seedEngagementCatalog(t, ctx, pg.DB, "CAS00001")
	if _, err := insertEpisodeView(ctx, pg.DB, cascadeSeed, cascadeSeed.userID, cascadeSeed.seriesID, cascadeSeed.episodeID, 1); err != nil {
		t.Fatalf("seed cascade event: %v", err)
	}
	if _, err := pg.DB.ExecContext(ctx, `DELETE FROM users WHERE id = $1`, cascadeSeed.userID); err != nil {
		t.Fatalf("delete user: %v", err)
	}
	var remaining int
	if err := pg.DB.QueryRowContext(ctx, `
		SELECT count(*) FROM content_events WHERE tenant_id = $1
	`, cascadeSeed.tenantID).Scan(&remaining); err != nil {
		t.Fatalf("count after user delete: %v", err)
	}
	if remaining != 0 {
		t.Fatalf("events after user delete = %d, want 0 (CASCADE)", remaining)
	}
}

func TestContentEventsActorKeyAndTargetChecks(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	seed := seedEngagementCatalog(t, ctx, pg.DB, "CHK00001")
	queries := dbmodels.New(pg.DB)
	anonID := uuid.Must(uuid.NewV7())

	both, err := queries.InsertDebouncedEpisodeViewEvent(ctx, dbmodels.InsertDebouncedEpisodeViewEventParams{
		ID:             uuid.Must(uuid.NewV7()),
		TenantID:       seed.tenantID,
		UserID:         nullUUID(seed.userID),
		AnonymousID:    nullUUID(anonID),
		SeriesID:       seed.seriesID,
		EpisodeID:      seed.episodeID,
		DebounceBucket: 1,
		Payload:        emptyPayload(),
		OccurredAt:     time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("insert with both actors: %v", err)
	}
	if !both.ActorKey.Valid || both.ActorKey.UUID != seed.userID {
		t.Fatalf("actor_key = %v, want user_id %s (user wins when both set)", both.ActorKey, seed.userID)
	}

	anonOnly, err := queries.InsertDebouncedEpisodeViewEvent(ctx, dbmodels.InsertDebouncedEpisodeViewEventParams{
		ID:             uuid.Must(uuid.NewV7()),
		TenantID:       seed.tenantID,
		AnonymousID:    nullUUID(anonID),
		SeriesID:       seed.seriesID,
		EpisodeID:      seed.episodeID,
		DebounceBucket: 2,
		Payload:        emptyPayload(),
		OccurredAt:     time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("insert anonymous view: %v", err)
	}
	if !anonOnly.ActorKey.Valid || anonOnly.ActorKey.UUID != anonID {
		t.Fatalf("actor_key = %v, want anonymous_id %s", anonOnly.ActorKey, anonID)
	}

	// No actor.
	_, err = pg.DB.ExecContext(ctx, `
		INSERT INTO content_events (
			id, tenant_id, event_type, series_id, episode_id, debounce_bucket, payload
		) VALUES ($1, $2, 'episode_view', $3, $4, 3, '{}'::jsonb)
	`, uuid.Must(uuid.NewV7()), seed.tenantID, seed.seriesID, seed.episodeID)
	if !isCheckViolation(err) || checkName(err) != "content_events_actor_check" {
		t.Fatalf("missing actor error = %v (%s), want content_events_actor_check", err, checkName(err))
	}

	// episode_view requires episode_id.
	_, err = pg.DB.ExecContext(ctx, `
		INSERT INTO content_events (
			id, tenant_id, event_type, user_id, series_id, debounce_bucket, payload
		) VALUES ($1, $2, 'episode_view', $3, $4, 4, '{}'::jsonb)
	`, uuid.Must(uuid.NewV7()), seed.tenantID, seed.userID, seed.seriesID)
	if !isCheckViolation(err) || checkName(err) != "content_events_target_by_type_check" {
		t.Fatalf("episode_view without episode error = %v (%s), want content_events_target_by_type_check", err, checkName(err))
	}

	// series_view must not carry an episode_id.
	_, err = pg.DB.ExecContext(ctx, `
		INSERT INTO content_events (
			id, tenant_id, event_type, user_id, series_id, episode_id, debounce_bucket, payload
		) VALUES ($1, $2, 'series_view', $3, $4, $5, 5, '{}'::jsonb)
	`, uuid.Must(uuid.NewV7()), seed.tenantID, seed.userID, seed.seriesID, seed.episodeID)
	if !isCheckViolation(err) || checkName(err) != "content_events_target_by_type_check" {
		t.Fatalf("series_view with episode error = %v (%s), want content_events_target_by_type_check", err, checkName(err))
	}

	// episode_view requires debounce_bucket.
	_, err = pg.DB.ExecContext(ctx, `
		INSERT INTO content_events (
			id, tenant_id, event_type, user_id, series_id, episode_id, payload
		) VALUES ($1, $2, 'episode_view', $3, $4, $5, '{}'::jsonb)
	`, uuid.Must(uuid.NewV7()), seed.tenantID, seed.userID, seed.seriesID, seed.episodeID)
	if !isCheckViolation(err) || checkName(err) != "content_events_view_bucket_check" {
		t.Fatalf("episode_view without bucket error = %v (%s), want content_events_view_bucket_check", err, checkName(err))
	}

	// rating requires score 1–5.
	_, err = pg.DB.ExecContext(ctx, `
		INSERT INTO content_events (
			id, tenant_id, event_type, user_id, series_id, payload
		) VALUES ($1, $2, 'rating', $3, $4, '{}'::jsonb)
	`, uuid.Must(uuid.NewV7()), seed.tenantID, seed.userID, seed.seriesID)
	if !isCheckViolation(err) || checkName(err) != "content_events_rating_requires_score_check" {
		t.Fatalf("rating without score error = %v (%s), want content_events_rating_requires_score_check", err, checkName(err))
	}

	_, err = pg.DB.ExecContext(ctx, `
		INSERT INTO content_events (
			id, tenant_id, event_type, user_id, series_id, rating_score, payload
		) VALUES ($1, $2, 'rating', $3, $4, 6, '{}'::jsonb)
	`, uuid.Must(uuid.NewV7()), seed.tenantID, seed.userID, seed.seriesID)
	if !isCheckViolation(err) || checkName(err) != "content_events_rating_score_check" {
		t.Fatalf("rating score 6 error = %v (%s), want content_events_rating_score_check", err, checkName(err))
	}

	okRating, err := queries.InsertContentEvent(ctx, dbmodels.InsertContentEventParams{
		ID:          uuid.Must(uuid.NewV7()),
		TenantID:    seed.tenantID,
		EventType:   "rating",
		UserID:      nullUUID(seed.userID),
		SeriesID:    nullUUID(seed.seriesID),
		RatingScore: sql.NullInt16{Int16: 5, Valid: true},
		Payload:     emptyPayload(),
		OccurredAt:  time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("valid series rating: %v", err)
	}
	if okRating.RatingScore.Int16 != 5 {
		t.Fatalf("rating_score = %d, want 5", okRating.RatingScore.Int16)
	}
}

func TestEngagementSnapshotQueriesRoundTrip(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	seed := seedEngagementCatalog(t, ctx, pg.DB, "SNP00001")
	queries := dbmodels.New(pg.DB)
	statDate := time.Date(2026, 8, 15, 0, 0, 0, 0, time.UTC)

	stats, err := queries.UpsertContentDailyStats(ctx, dbmodels.UpsertContentDailyStatsParams{
		ID:                uuid.Must(uuid.NewV7()),
		TenantID:          seed.tenantID,
		StatDate:          statDate,
		EntityType:        "episode",
		EntityID:          seed.episodeID,
		ViewCount:         10,
		UniqueViewerCount: 4,
		PurchaseCount:     1,
		RatingCount:       2,
		RatingSum:         8,
		FavoriteCount:     0,
	})
	if err != nil {
		t.Fatalf("upsert daily stats: %v", err)
	}
	if stats.ViewCount != 10 {
		t.Fatalf("view_count = %d, want 10", stats.ViewCount)
	}

	userFeat, err := queries.UpsertUserRecommendFeatures(ctx, dbmodels.UpsertUserRecommendFeaturesParams{
		TenantID:       seed.tenantID,
		UserID:         seed.userID,
		Features:       json.RawMessage(`{"recent_series":[]}`),
		FeatureVersion: 1,
		ComputedAt:     time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("upsert user features: %v", err)
	}
	if userFeat.FeatureVersion != 1 {
		t.Fatalf("user feature_version = %d, want 1", userFeat.FeatureVersion)
	}

	itemFeat, err := queries.UpsertItemRecommendFeatures(ctx, dbmodels.UpsertItemRecommendFeaturesParams{
		TenantID:       seed.tenantID,
		EntityType:     "series",
		EntityID:       seed.seriesID,
		Features:       json.RawMessage(`{"view_7d":10}`),
		FeatureVersion: 1,
		ComputedAt:     time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("upsert item features: %v", err)
	}
	if itemFeat.EntityType != "series" {
		t.Fatalf("item entity_type = %q, want series", itemFeat.EntityType)
	}

	snapshot, err := queries.UpsertContentRankingSnapshot(ctx, dbmodels.UpsertContentRankingSnapshotParams{
		ID:               uuid.Must(uuid.NewV7()),
		TenantID:         seed.tenantID,
		RankingKey:       "weekly_series",
		PeriodStart:      statDate,
		PeriodEnd:        statDate.Add(6 * 24 * time.Hour),
		EntityType:       "series",
		Items:            json.RawMessage(`[{"entity_id":"` + seed.seriesID.String() + `","score":1,"rank":1}]`),
		AlgorithmVersion: 1,
		ComputedAt:       time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("upsert ranking snapshot: %v", err)
	}
	if snapshot.RankingKey != "weekly_series" {
		t.Fatalf("ranking_key = %q, want weekly_series", snapshot.RankingKey)
	}
}

func insertEpisodeView(ctx context.Context, db *sql.DB, seed engagementSeed, userID, seriesID, episodeID uuid.UUID, bucket int64) (uuid.UUID, error) {
	id, err := uuid.NewV7()
	if err != nil {
		return uuid.Nil, err
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO content_events (
			id, tenant_id, event_type, user_id, series_id, episode_id, debounce_bucket, payload
		) VALUES ($1, $2, 'episode_view', $3, $4, $5, $6, '{}'::jsonb)
	`, id, seed.tenantID, userID, seriesID, episodeID, bucket)
	return id, err
}
