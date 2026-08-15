package dbmodels_test

import (
	"context"
	"database/sql"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/testutil"
)

func TestListAnnouncementsForUserPaginatesBothDirections(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "NOTIFTENANT1", "notif.example.com", "admin-notif.example.com", "Notification Tenant")
	userID := mustInsertUser(t, ctx, pg.DB, tenantID, "NOTIFUSER001", "notif-user@example.com", "Notification User")
	otherUserID := mustInsertUser(t, ctx, pg.DB, tenantID, "NOTIFUSER002", "notif-other@example.com", "Other User")
	createdAt := time.Now().UTC().Truncate(time.Microsecond)
	ids := make([]uuid.UUID, 4)
	for index := range ids {
		ids[index] = mustInsertAnnouncement(t, ctx, pg.DB, tenantID, uuid.NullUUID{}, createdAt.Add(-time.Duration(index)*time.Minute))
	}
	// Addressed to somebody else, so it must stay out of every page.
	mustInsertAnnouncement(t, ctx, pg.DB, tenantID, uuid.NullUUID{UUID: otherUserID, Valid: true}, createdAt.Add(-30*time.Second))

	queries := dbmodels.New(pg.DB)
	firstPage, err := queries.ListAnnouncementsForUserDesc(ctx, dbmodels.ListAnnouncementsForUserDescParams{
		TenantID: tenantID,
		UserID:   userID,
		Limit:    2,
	})
	if err != nil {
		t.Fatalf("ListAnnouncementsForUserDesc first page: %v", err)
	}
	if got := announcementDescIDs(firstPage); !slices.Equal(got, ids[:2]) {
		t.Fatalf("first page IDs = %v, want %v", got, ids[:2])
	}

	inclusiveNextPage, err := queries.ListAnnouncementsForUserDesc(ctx, dbmodels.ListAnnouncementsForUserDescParams{
		TenantID:        tenantID,
		UserID:          userID,
		CursorID:        uuid.NullUUID{UUID: firstPage[1].ID, Valid: true},
		CursorCreatedAt: sql.NullTime{Time: firstPage[1].CreatedAt, Valid: true},
		CursorInclusive: true,
		Limit:           2,
	})
	if err != nil {
		t.Fatalf("ListAnnouncementsForUserDesc inclusive page: %v", err)
	}
	if got := announcementDescIDs(inclusiveNextPage); !slices.Equal(got, ids[1:3]) {
		t.Fatalf("inclusive next page IDs = %v, want boundary included %v", got, ids[1:3])
	}

	secondPage, err := queries.ListAnnouncementsForUserDesc(ctx, dbmodels.ListAnnouncementsForUserDescParams{
		TenantID:        tenantID,
		UserID:          userID,
		CursorID:        uuid.NullUUID{UUID: firstPage[1].ID, Valid: true},
		CursorCreatedAt: sql.NullTime{Time: firstPage[1].CreatedAt, Valid: true},
		Limit:           2,
	})
	if err != nil {
		t.Fatalf("ListAnnouncementsForUserDesc second page: %v", err)
	}
	if got := announcementDescIDs(secondPage); !slices.Equal(got, ids[2:]) {
		t.Fatalf("second page IDs = %v, want %v", got, ids[2:])
	}

	previousPage, err := queries.ListAnnouncementsForUserAsc(ctx, dbmodels.ListAnnouncementsForUserAscParams{
		TenantID:        tenantID,
		UserID:          userID,
		CursorID:        uuid.NullUUID{UUID: secondPage[0].ID, Valid: true},
		CursorCreatedAt: sql.NullTime{Time: secondPage[0].CreatedAt, Valid: true},
		Limit:           2,
	})
	if err != nil {
		t.Fatalf("ListAnnouncementsForUserAsc previous page: %v", err)
	}
	wantPreviousScan := []uuid.UUID{ids[1], ids[0]}
	if got := announcementAscIDs(previousPage); !slices.Equal(got, wantPreviousScan) {
		t.Fatalf("previous page scan IDs = %v, want ascending scan %v", got, wantPreviousScan)
	}

	inclusivePreviousPage, err := queries.ListAnnouncementsForUserAsc(ctx, dbmodels.ListAnnouncementsForUserAscParams{
		TenantID:        tenantID,
		UserID:          userID,
		CursorID:        uuid.NullUUID{UUID: secondPage[0].ID, Valid: true},
		CursorCreatedAt: sql.NullTime{Time: secondPage[0].CreatedAt, Valid: true},
		CursorInclusive: true,
		Limit:           2,
	})
	if err != nil {
		t.Fatalf("ListAnnouncementsForUserAsc inclusive page: %v", err)
	}
	wantInclusivePreviousScan := []uuid.UUID{ids[2], ids[1]}
	if got := announcementAscIDs(inclusivePreviousPage); !slices.Equal(got, wantInclusivePreviousScan) {
		t.Fatalf("inclusive previous page IDs = %v, want boundary included %v", got, wantInclusivePreviousScan)
	}
}

// Announcements created within the same clock tick still have to land on
// separate pages, which is what the id tiebreaker in the sort key is for.
func TestListAnnouncementsForUserPaginatesRowsSharingCreatedAt(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "NOTIFTENANT2", "notif2.example.com", "admin-notif2.example.com", "Notification Tenant 2")
	userID := mustInsertUser(t, ctx, pg.DB, tenantID, "NOTIFUSER003", "notif-tie@example.com", "Tie User")
	createdAt := time.Now().UTC().Truncate(time.Microsecond)
	ids := make([]uuid.UUID, 3)
	for index := range ids {
		ids[index] = mustInsertAnnouncement(t, ctx, pg.DB, tenantID, uuid.NullUUID{}, createdAt)
	}

	queries := dbmodels.New(pg.DB)
	firstPage, err := queries.ListAnnouncementsForUserDesc(ctx, dbmodels.ListAnnouncementsForUserDescParams{
		TenantID: tenantID,
		UserID:   userID,
		Limit:    2,
	})
	if err != nil {
		t.Fatalf("ListAnnouncementsForUserDesc first page: %v", err)
	}
	if len(firstPage) != 2 {
		t.Fatalf("first page count = %d, want the page filled to the limit", len(firstPage))
	}
	secondPage, err := queries.ListAnnouncementsForUserDesc(ctx, dbmodels.ListAnnouncementsForUserDescParams{
		TenantID:        tenantID,
		UserID:          userID,
		CursorID:        uuid.NullUUID{UUID: firstPage[1].ID, Valid: true},
		CursorCreatedAt: sql.NullTime{Time: firstPage[1].CreatedAt, Valid: true},
		Limit:           2,
	})
	if err != nil {
		t.Fatalf("ListAnnouncementsForUserDesc second page: %v", err)
	}
	if len(secondPage) != 1 {
		t.Fatalf("second page count = %d, want the single remaining row", len(secondPage))
	}

	seen := append(announcementDescIDs(firstPage), announcementDescIDs(secondPage)...)
	if !slices.Equal(sortedUUIDs(seen), sortedUUIDs(ids)) {
		t.Fatalf("paged IDs = %v, want every row exactly once %v", seen, ids)
	}
}

func TestGetAnnouncementForUserRespectsInbox(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "NOTIFTENANT2", "notif2.example.com", "admin-notif2.example.com", "Notification Tenant 2")
	otherTenantID := mustInsertTenant(t, ctx, pg.DB, "NOTIFTENANT3", "notif3.example.com", "admin-notif3.example.com", "Notification Tenant 3")
	userID := mustInsertUser(t, ctx, pg.DB, tenantID, "NOTIFUSER011", "notif-user2@example.com", "Notification User")
	otherUserID := mustInsertUser(t, ctx, pg.DB, tenantID, "NOTIFUSER012", "notif-other2@example.com", "Other User")
	createdAt := time.Now().UTC().Truncate(time.Microsecond)

	broadcastID := mustInsertAnnouncement(t, ctx, pg.DB, tenantID, uuid.NullUUID{}, createdAt)
	mineID := mustInsertAnnouncement(t, ctx, pg.DB, tenantID, uuid.NullUUID{UUID: userID, Valid: true}, createdAt.Add(-time.Minute))
	theirsID := mustInsertAnnouncement(t, ctx, pg.DB, tenantID, uuid.NullUUID{UUID: otherUserID, Valid: true}, createdAt.Add(-2*time.Minute))
	foreignID := mustInsertAnnouncement(t, ctx, pg.DB, otherTenantID, uuid.NullUUID{}, createdAt)

	queries := dbmodels.New(pg.DB)
	broadcast, err := queries.GetAnnouncementForUser(ctx, dbmodels.GetAnnouncementForUserParams{
		ID:       broadcastID,
		TenantID: tenantID,
		UserID:   userID,
	})
	if err != nil {
		t.Fatalf("GetAnnouncementForUser broadcast: %v", err)
	}
	if broadcast.ID != broadcastID {
		t.Fatalf("broadcast id = %v, want %v", broadcast.ID, broadcastID)
	}

	mine, err := queries.GetAnnouncementForUser(ctx, dbmodels.GetAnnouncementForUserParams{
		ID:       mineID,
		TenantID: tenantID,
		UserID:   userID,
	})
	if err != nil {
		t.Fatalf("GetAnnouncementForUser targeted: %v", err)
	}
	if mine.ID != mineID {
		t.Fatalf("targeted id = %v, want %v", mine.ID, mineID)
	}

	for _, announcementID := range []uuid.UUID{theirsID, foreignID, uuid.Must(uuid.NewV7())} {
		_, err := queries.GetAnnouncementForUser(ctx, dbmodels.GetAnnouncementForUserParams{
			ID:       announcementID,
			TenantID: tenantID,
			UserID:   userID,
		})
		if err != sql.ErrNoRows {
			t.Fatalf("GetAnnouncementForUser %s err = %v, want sql.ErrNoRows", announcementID, err)
		}
	}
}

func sortedUUIDs(ids []uuid.UUID) []uuid.UUID {
	sorted := slices.Clone(ids)
	slices.SortFunc(sorted, func(left, right uuid.UUID) int {
		return slices.Compare(left[:], right[:])
	})
	return sorted
}

func mustInsertAnnouncement(
	t *testing.T,
	ctx context.Context,
	db *sql.DB,
	tenantID uuid.UUID,
	targetUserID uuid.NullUUID,
	createdAt time.Time,
) uuid.UUID {
	t.Helper()
	id := uuid.Must(uuid.NewV7())
	_, err := db.ExecContext(ctx, `
		INSERT INTO announcements (
			id, tenant_id, target_user_id, announcement_type, title, body, created_at
		) VALUES ($1, $2, $3, 'member_episode_published', 'title', 'body', $4)
	`, id, tenantID, targetUserID, createdAt)
	if err != nil {
		t.Fatalf("insert announcement: %v", err)
	}
	return id
}

func announcementDescIDs(rows []dbmodels.ListAnnouncementsForUserDescRow) []uuid.UUID {
	ids := make([]uuid.UUID, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
	}
	return ids
}

func announcementAscIDs(rows []dbmodels.ListAnnouncementsForUserAscRow) []uuid.UUID {
	ids := make([]uuid.UUID, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
	}
	return ids
}
