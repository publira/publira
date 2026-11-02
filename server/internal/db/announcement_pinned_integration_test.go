package dbtest

import (
	"context"
	"database/sql"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/testutil"
)

// mustInsertPinnedAnnouncement writes one announcement already pinned, with the
// instant its banner is asked to stop at.
func mustInsertPinnedAnnouncement(
	t *testing.T,
	ctx context.Context,
	db *sql.DB,
	tenantID uuid.UUID,
	createdAt time.Time,
	pinnedUntil sql.NullTime,
) uuid.UUID {
	t.Helper()
	id := uuid.Must(uuid.NewV7())
	_, err := db.ExecContext(ctx, `
		INSERT INTO announcements (
			id, tenant_id, announcement_type, created_at, delivered_at, pinned, pinned_until
		) VALUES ($1, $2, 'announcement', $3, $3, true, $4)
	`, id, tenantID, createdAt, pinnedUntil)
	if err != nil {
		t.Fatalf("insert pinned announcement: %v", err)
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO announcement_translations (id, announcement_id, tenant_id, locale, title, body)
		SELECT uuidv7(), $1, t.id, t.default_locale, 'title', 'body'
		FROM tenants t
		WHERE t.id = $2
	`, id, tenantID)
	if err != nil {
		t.Fatalf("insert pinned announcement translation: %v", err)
	}
	return id
}

func TestGetPinnedAnnouncementForTenantAnswersTheNewestOpenWindow(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "PINTENANT001", "pin.example.com", "admin-pin.example.com", "Pinned Tenant")
	now := time.Now().UTC()

	// Older than the one that should win, and open with no end at all.
	mustInsertPinnedAnnouncement(t, ctx, pg.DB, tenantID, now.Add(-2*time.Hour), sql.NullTime{})
	newest := mustInsertPinnedAnnouncement(t, ctx, pg.DB, tenantID, now.Add(-time.Hour), sql.NullTime{Time: now.Add(time.Hour), Valid: true})
	// Its window has closed.
	mustInsertPinnedAnnouncement(t, ctx, pg.DB, tenantID, now, sql.NullTime{Time: now.Add(-time.Minute), Valid: true})
	// Not pinned at all.
	mustInsertAnnouncement(t, ctx, pg.DB, tenantID, now)

	queries := dbmodels.New(pg.DB)
	row, err := queries.GetPinnedAnnouncementForTenant(ctx, dbmodels.GetPinnedAnnouncementForTenantParams{TenantID: tenantID, Locale: "ja"})
	if err != nil {
		t.Fatalf("GetPinnedAnnouncementForTenant: %v", err)
	}
	if row.ID != newest {
		t.Fatalf("pinned announcement = %v, want %v", row.ID, newest)
	}
}

func TestGetPinnedAnnouncementForTenantAnswersNothingWhenEveryWindowHasClosed(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "PINTENANT002", "pin2.example.com", "admin-pin2.example.com", "Pinned Tenant 2")
	now := time.Now().UTC()
	mustInsertPinnedAnnouncement(t, ctx, pg.DB, tenantID, now, sql.NullTime{Time: now.Add(-time.Second), Valid: true})

	queries := dbmodels.New(pg.DB)
	if _, err := queries.GetPinnedAnnouncementForTenant(ctx, dbmodels.GetPinnedAnnouncementForTenantParams{TenantID: tenantID, Locale: "ja"}); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("GetPinnedAnnouncementForTenant error = %v, want sql.ErrNoRows", err)
	}
}

func TestUnpinAnnouncementStopsTheBannerAndKeepsTheRow(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "PINTENANT003", "pin3.example.com", "admin-pin3.example.com", "Pinned Tenant 3")
	userID := mustInsertUser(t, ctx, pg.DB, tenantID, "PINUSER00003", "pin-user3@example.com", "Pinned User 3")
	now := time.Now().UTC()
	announcementID := mustInsertPinnedAnnouncement(t, ctx, pg.DB, tenantID, now, sql.NullTime{})

	queries := dbmodels.New(pg.DB)
	if _, err := queries.UnpinAnnouncement(ctx, dbmodels.UnpinAnnouncementParams{ID: announcementID, TenantID: tenantID}); err != nil {
		t.Fatalf("UnpinAnnouncement: %v", err)
	}

	if _, err := queries.GetPinnedAnnouncementForTenant(ctx, dbmodels.GetPinnedAnnouncementForTenantParams{TenantID: tenantID, Locale: "ja"}); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("GetPinnedAnnouncementForTenant error = %v, want sql.ErrNoRows", err)
	}

	rows, err := queries.ListAnnouncementsForUserDesc(ctx, dbmodels.ListAnnouncementsForUserDescParams{
		TenantID: tenantID,
		UserID:   uuid.NullUUID{UUID: userID, Valid: true},
		Limit:    10,
	})
	if err != nil {
		t.Fatalf("ListAnnouncementsForUserDesc: %v", err)
	}
	if got := announcementDescIDs(rows); !slices.Equal(got, []uuid.UUID{announcementID}) {
		t.Fatalf("list IDs = %v, want the unpinned announcement still listed", got)
	}
}

func TestListPinnedAnnouncementsDueNamesOnlyClosedWindows(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "PINTENANT004", "pin4.example.com", "admin-pin4.example.com", "Pinned Tenant 4")
	now := time.Now().UTC()
	closed := mustInsertPinnedAnnouncement(t, ctx, pg.DB, tenantID, now, sql.NullTime{Time: now.Add(-time.Minute), Valid: true})
	mustInsertPinnedAnnouncement(t, ctx, pg.DB, tenantID, now, sql.NullTime{Time: now.Add(time.Hour), Valid: true})
	mustInsertPinnedAnnouncement(t, ctx, pg.DB, tenantID, now, sql.NullTime{})

	queries := dbmodels.New(pg.DB)
	due, err := queries.ListPinnedAnnouncementsDue(ctx)
	if err != nil {
		t.Fatalf("ListPinnedAnnouncementsDue: %v", err)
	}
	ids := make([]uuid.UUID, 0, len(due))
	for _, row := range due {
		ids = append(ids, row.ID)
	}
	if !slices.Equal(ids, []uuid.UUID{closed}) {
		t.Fatalf("due = %v, want only the closed window %v", ids, closed)
	}

	if err := queries.ClearAnnouncementPin(ctx, closed); err != nil {
		t.Fatalf("ClearAnnouncementPin: %v", err)
	}
	after, err := queries.ListPinnedAnnouncementsDue(ctx)
	if err != nil {
		t.Fatalf("ListPinnedAnnouncementsDue after clearing: %v", err)
	}
	if len(after) != 0 {
		t.Fatalf("due after clearing = %v, want none", after)
	}
}

// A window the console moved to a later end after the job listed it is left
// up: the clear checks the window again instead of trusting the listing.
func TestClearAnnouncementPinLeavesAWindowExtendedAfterTheListing(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "PINTENANT005", "pin5.example.com", "admin-pin5.example.com", "Pinned Tenant 5")
	now := time.Now().UTC()
	listed := mustInsertPinnedAnnouncement(t, ctx, pg.DB, tenantID, now, sql.NullTime{Time: now.Add(-time.Minute), Valid: true})

	queries := dbmodels.New(pg.DB)
	due, err := queries.ListPinnedAnnouncementsDue(ctx)
	if err != nil {
		t.Fatalf("ListPinnedAnnouncementsDue: %v", err)
	}
	if len(due) != 1 || due[0].ID != listed {
		t.Fatalf("due = %v, want the closed window %v", due, listed)
	}
	if _, err := pg.DB.ExecContext(ctx, "UPDATE announcements SET pinned_until = now() + interval '1 hour' WHERE id = $1", listed); err != nil {
		t.Fatalf("extend window: %v", err)
	}

	if err := queries.ClearAnnouncementPin(ctx, listed); err != nil {
		t.Fatalf("ClearAnnouncementPin: %v", err)
	}
	var pinned bool
	if err := pg.DB.QueryRowContext(ctx, "SELECT pinned FROM announcements WHERE id = $1", listed).Scan(&pinned); err != nil {
		t.Fatalf("read pinned: %v", err)
	}
	if !pinned {
		t.Fatal("pinned = false, want the extended banner left up")
	}
}
