package dbtest

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/testutil"
)

// An account holding one of the three staff roles opens every episode of the
// tenant. The API reads the grant through UserHasEpisodeContentAccess and
// image-server through GetEpisodeImageAccessByIDForUser, so both are asked. A
// role string outside the three is no grant: tenant_user_roles.role carries no
// CHECK constraint, so the view is what keeps it from opening the catalogue.
func TestStaffGrantFollowsTheThreeStaffRoles(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	q := dbmodels.New(pg.DB)

	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Paid Series", Published: true})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEPAY01",
		Title:    "Paid Chapter",
		Status:   testutil.EpisodeStatusPublished,
		Price:    500,
	})
	imageID := pg.SeedEpisodeImage(t, tenant.ID, episode.ID, 1)

	other := pg.SeedTenant(t, "TENANTB", "tenant-b.example.com", "Tenant B")
	otherStaff := pg.SeedTenantAdmin(t, other.ID, "ADMINB000001", "admin@tenant-b.example.com", "Tenant B Admin")

	account := func(publicID, role string) uuid.UUID {
		user := pg.SeedEndUser(t, tenant.ID, publicID, publicID+"@tenant-a.example.com", publicID)
		if role != "" {
			pg.SeedTenantUserRole(t, tenant.ID, user.ID, role)
		}
		return user.ID
	}

	for _, tt := range []struct {
		name   string
		userID uuid.UUID
		want   bool
	}{
		{name: "tenant_admin", userID: account("STAFFADMIN01", auth.RoleTenantAdmin), want: true},
		{name: "tenant_editor", userID: account("STAFFEDITR01", auth.RoleTenantEditor), want: true},
		{name: "tenant_auditor", userID: account("STAFFAUDIT01", auth.RoleTenantAuditor), want: true},
		{name: "no role", userID: account("ENDUSERREA01", ""), want: false},
		{name: "a role string outside the three", userID: account("ENDUSERUNK01", "tenant_owner"), want: false},
		{name: "another tenant's staff", userID: otherStaff.ID, want: false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			assertContentAccess(t, ctx, q, tenant.ID, tt.userID, episode.ID, tt.want)
			image, err := q.GetEpisodeImageAccessByIDForUser(ctx, dbmodels.GetEpisodeImageAccessByIDForUserParams{
				ID:       imageID,
				TenantID: tenant.ID,
				UserID:   tt.userID,
			})
			if err != nil {
				t.Fatalf("GetEpisodeImageAccessByIDForUser: %v", err)
			}
			if image.HasAccess != tt.want {
				t.Fatalf("image has_access = %v, want %v", image.HasAccess, tt.want)
			}
			isStaff, err := q.ReaderHoldsStaffGrantOnEpisode(ctx, dbmodels.ReaderHoldsStaffGrantOnEpisodeParams{
				TenantID:  tenant.ID,
				UserID:    tt.userID,
				EpisodeID: episode.ID,
			})
			if err != nil {
				t.Fatalf("ReaderHoldsStaffGrantOnEpisode: %v", err)
			}
			if isStaff != tt.want {
				t.Fatalf("is_staff = %v, want %v", isStaff, tt.want)
			}
		})
	}
}

// The staff grant holds every episode, so it is reported only when the reader
// holds nothing else: a purchase a member of staff made stays the purchase.
// The episode detail and the series' episode access report in the same order,
// so both are asked at every step.
func TestEpisodeEntitlementSourceReportsTheStaffGrantLast(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	q := dbmodels.New(pg.DB)

	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Paid Series", Published: true})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEPAY01",
		Title:    "Paid Chapter",
		Status:   testutil.EpisodeStatusPublished,
		Price:    500,
	})
	staff := pg.SeedEndUser(t, tenant.ID, "STAFFEDITR01", "editor@tenant-a.example.com", "Editor")

	assertSource := func(t *testing.T, want string) {
		t.Helper()
		kind, err := q.GetEpisodeEntitlementSource(ctx, dbmodels.GetEpisodeEntitlementSourceParams{
			TenantID:  tenant.ID,
			UserID:    staff.ID,
			EpisodeID: episode.ID,
		})
		if errors.Is(err, sql.ErrNoRows) {
			kind = ""
		} else if err != nil {
			t.Fatalf("GetEpisodeEntitlementSource: %v", err)
		}
		if kind != want {
			t.Fatalf("GetEpisodeEntitlementSource = %q, want %q", kind, want)
		}
		rows, err := q.ListPublishedEpisodeAccessInSeries(ctx, dbmodels.ListPublishedEpisodeAccessInSeriesParams{
			UserID:   uuid.NullUUID{UUID: staff.ID, Valid: true},
			TenantID: tenant.ID,
			SeriesID: series.ID,
			Surface:  "web",
		})
		if err != nil {
			t.Fatalf("ListPublishedEpisodeAccessInSeries: %v", err)
		}
		if len(rows) != 1 || rows[0].GrantKind != want {
			t.Fatalf("ListPublishedEpisodeAccessInSeries = %+v, want one episode granted by %q", rows, want)
		}
	}

	assertSource(t, "")
	pg.SeedTenantUserRole(t, tenant.ID, staff.ID, auth.RoleTenantEditor)
	assertSource(t, "staff")
	mustInsertAccessTicketWithTimes(t, ctx, pg.DB, tenant.ID, "TICKETVALID1", episode.ID, staff.ID, nil, nil)
	assertSource(t, "access_ticket")
	pg.SeedPurchase(t, tenant.ID, staff.ID, episode.ID, 500)
	assertSource(t, "purchase")
	creator := pg.SeedCreator(t, tenant.ID, testutil.CreatorSeed{Name: "Credited"})
	pg.SeedEpisodeCreator(t, tenant.ID, episode.ID, creator.ID, "")
	pg.SeedCreatorAccount(t, tenant.ID, creator.ID, staff.ID)
	assertSource(t, "creator")
}
