package dbtest

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/testutil"
)

// The announcement fan-out walks this query one page at a time and writes a
// notification per row, so a page that repeated or skipped a reader would leave
// someone told twice or not at all.
func TestListTenantUserIDsWalksEveryUserOnce(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "FANOUTTNT001", "fanout.example.com", "admin-fanout.example.com", "Fanout Tenant")
	otherTenantID := mustInsertTenant(t, ctx, pg.DB, "FANOUTTNT002", "other-fanout.example.com", "admin-other-fanout.example.com", "Other Fanout Tenant")

	want := make([]uuid.UUID, 5)
	for index := range want {
		want[index] = mustInsertUser(
			t, ctx, pg.DB, tenantID,
			fmt.Sprintf("FANOUT%06d", index),
			fmt.Sprintf("fanout-%d@example.com", index),
			fmt.Sprintf("Reader %d", index),
		)
	}
	slices.SortFunc(want, func(a, b uuid.UUID) int { return bytes.Compare(a[:], b[:]) })
	mustInsertUser(t, ctx, pg.DB, otherTenantID, "OTHERFAN0001", "other-fanout@example.com", "Other Reader")

	queries := dbmodels.New(pg.DB)
	tenant := uuid.NullUUID{UUID: tenantID, Valid: true}

	// The nil UUID sorts below every UUID, so it is what the first page asks
	// for and the walk needs no separate first-page query.
	var got []uuid.UUID
	after := uuid.Nil
	for {
		page, err := queries.ListTenantUserIDs(ctx, dbmodels.ListTenantUserIDsParams{
			TenantID:    tenant,
			AfterUserID: after,
			Limit:       2,
		})
		if err != nil {
			t.Fatalf("ListTenantUserIDs after %s: %v", after, err)
		}
		if len(page) == 0 {
			break
		}
		got = append(got, page...)
		after = page[len(page)-1]
	}

	if !slices.Equal(got, want) {
		t.Fatalf("recipients = %v, want every user of the tenant in id order %v", got, want)
	}
}

// A targeted notification takes its recipient from an event payload, and
// `notifications` holds the tenant and the user as two separate foreign keys —
// so this lookup is what keeps a pair naming two tenants from being written.
func TestGetTenantUserIDAnswersOnlyForThatTenant(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "TARGETTNT001", "target.example.com", "admin-target.example.com", "Target Tenant")
	otherTenantID := mustInsertTenant(t, ctx, pg.DB, "TARGETTNT002", "other-target.example.com", "admin-other-target.example.com", "Other Target Tenant")
	userID := mustInsertUser(t, ctx, pg.DB, tenantID, "TARGETUSR001", "target-user@example.com", "Target Reader")

	queries := dbmodels.New(pg.DB)
	found, err := queries.GetTenantUserID(ctx, dbmodels.GetTenantUserIDParams{
		TenantID: uuid.NullUUID{UUID: tenantID, Valid: true},
		UserID:   userID,
	})
	if err != nil {
		t.Fatalf("GetTenantUserID for the owning tenant: %v", err)
	}
	if found != userID {
		t.Fatalf("resolved user = %s, want %s", found, userID)
	}

	_, err = queries.GetTenantUserID(ctx, dbmodels.GetTenantUserIDParams{
		TenantID: uuid.NullUUID{UUID: otherTenantID, Valid: true},
		UserID:   userID,
	})
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("GetTenantUserID for another tenant = %v, want sql.ErrNoRows", err)
	}
}
