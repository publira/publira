package dbtest

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/testutil"
)

// A linked account opens an episode through the credit the episode itself
// carries. The API reads the grant through UserHasEpisodeContentAccess and
// image-server through GetEpisodeImageAccessByIDForUser, so both are asked.
func TestCreatorGrantFollowsTheEpisodeCredit(t *testing.T) {
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

	credited := pg.SeedCreator(t, tenant.ID, testutil.CreatorSeed{Name: "Credited"})
	pg.SeedSeriesCreator(t, tenant.ID, series.ID, credited.ID, "")
	pg.SeedEpisodeCreator(t, tenant.ID, episode.ID, credited.ID, "")
	seriesOnly := pg.SeedCreator(t, tenant.ID, testutil.CreatorSeed{Name: "Series Only"})
	pg.SeedSeriesCreator(t, tenant.ID, series.ID, seriesOnly.ID, "")
	uncredited := pg.SeedCreator(t, tenant.ID, testutil.CreatorSeed{Name: "Uncredited"})
	unlinked := pg.SeedCreator(t, tenant.ID, testutil.CreatorSeed{Name: "Unlinked"})
	pg.SeedEpisodeCreator(t, tenant.ID, episode.ID, unlinked.ID, "")

	author := pg.SeedEndUser(t, tenant.ID, "ENDUSERAUT01", "author@tenant-a.example.com", "Author")
	pg.SeedCreatorAccount(t, tenant.ID, credited.ID, author.ID)
	seriesAuthor := pg.SeedEndUser(t, tenant.ID, "ENDUSERSER01", "series@tenant-a.example.com", "Series Author")
	pg.SeedCreatorAccount(t, tenant.ID, seriesOnly.ID, seriesAuthor.ID)
	stranger := pg.SeedEndUser(t, tenant.ID, "ENDUSERSTR01", "stranger@tenant-a.example.com", "Stranger")
	pg.SeedCreatorAccount(t, tenant.ID, uncredited.ID, stranger.ID)
	reader := pg.SeedEndUser(t, tenant.ID, "ENDUSERREA01", "reader@tenant-a.example.com", "Reader")

	for _, tt := range []struct {
		name   string
		userID uuid.UUID
		want   bool
	}{
		{name: "linked to a creator the episode credits", userID: author.ID, want: true},
		{name: "linked to a creator only the series credits", userID: seriesAuthor.ID, want: false},
		{name: "linked to a creator nothing credits", userID: stranger.ID, want: false},
		{name: "linked to nobody", userID: reader.ID, want: false},
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
		})
	}
}

// A reader can hold several grants on one episode. The creator grant is the
// one reported, then a purchase, then a ticket.
func TestEpisodeEntitlementSourcePrefersTheCreatorGrant(t *testing.T) {
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
	reader := pg.SeedEndUser(t, tenant.ID, "ENDUSERREA01", "reader@tenant-a.example.com", "Reader")

	source := func(t *testing.T) string {
		t.Helper()
		kind, err := q.GetEpisodeEntitlementSource(ctx, dbmodels.GetEpisodeEntitlementSourceParams{
			TenantID:  tenant.ID,
			UserID:    reader.ID,
			EpisodeID: episode.ID,
		})
		if errors.Is(err, sql.ErrNoRows) {
			return ""
		}
		if err != nil {
			t.Fatalf("GetEpisodeEntitlementSource: %v", err)
		}
		return kind
	}

	if got := source(t); got != "" {
		t.Fatalf("source without a grant = %q, want none", got)
	}
	mustInsertAccessTicketWithTimes(t, ctx, pg.DB, tenant.ID, "TICKETVALID1", episode.ID, reader.ID, nil, nil)
	if got := source(t); got != "access_ticket" {
		t.Fatalf("source with a ticket = %q, want access_ticket", got)
	}
	pg.SeedPurchase(t, tenant.ID, reader.ID, episode.ID, 500)
	if got := source(t); got != "purchase" {
		t.Fatalf("source with a ticket and a purchase = %q, want purchase", got)
	}
	creator := pg.SeedCreator(t, tenant.ID, testutil.CreatorSeed{Name: "Credited"})
	pg.SeedEpisodeCreator(t, tenant.ID, episode.ID, creator.ID, "")
	pg.SeedCreatorAccount(t, tenant.ID, creator.ID, reader.ID)
	if got := source(t); got != "creator" {
		t.Fatalf("source with every grant = %q, want creator", got)
	}
}
