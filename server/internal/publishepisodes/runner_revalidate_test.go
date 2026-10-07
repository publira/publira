package publishepisodes

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"slices"
	"testing"
	"time"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/revalidate"
)

// Publishing changes the series lists as well as the series' own page: the
// order by latest update sorts on the newest published episode, and the
// free-episode counts count the published ones.
func TestPublishRecordsTheDropOfTheSeriesDetailAndLists(t *testing.T) {
	pg, env := newPublishTestEnv(t)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	// The requester only records here: it has no pool to mark a send done on,
	// which is how the worker runs it, so the target is never called.
	t.Setenv("PUBLIRA_WEB_HOST_INTERNAL_URL", "http://web-host.invalid")
	client, err := revalidate.NewClient("test-revalidate-token", logger)
	if err != nil {
		t.Fatalf("revalidate.NewClient: %v", err)
	}
	reval := revalidate.NewRequester(revalidate.RequesterConfig{
		Client:  client,
		Queries: dbmodels.New(pg.DB),
		Logger:  logger,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	New(pg.DB, dbmodels.New(pg.DB), reval, logger, 0).RunOnce(ctx)

	rows, err := pg.DB.QueryContext(ctx,
		"SELECT payload FROM outbox_events WHERE event_type = $1", outbox.EventTypeNextCacheRevalidation)
	if err != nil {
		t.Fatalf("list cache invalidations: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	var recorded [][]string
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			t.Fatalf("scan cache invalidation: %v", err)
		}
		var payload outbox.NextCacheRevalidationPayload
		if err := json.Unmarshal(raw, &payload); err != nil {
			t.Fatalf("decode cache invalidation: %v", err)
		}
		if payload.TenantID != env.tenant.ID.String() {
			t.Fatalf("cache invalidation tenant = %s, want %s", payload.TenantID, env.tenant.ID)
		}
		recorded = append(recorded, payload.Tags)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("list cache invalidations: %v", err)
	}

	want := []string{
		"tenant:" + env.tenant.ID.String() + ":series:detail",
		"tenant:" + env.tenant.ID.String() + ":series:list",
	}
	if len(recorded) != 1 || !slices.Equal(recorded[0], want) {
		t.Fatalf("recorded cache invalidations = %v, want one of %v", recorded, want)
	}
}
