package publicapi

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/ageverification"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// seedAccessTicket grants a reader one episode the way the console issues a
// ticket, with an optional expiry and revocation.
func seedAccessTicket(t *testing.T, env *publicDBEnv, tenantID uuid.UUID, publicID string, episodeID, userID uuid.UUID, expiresAt, revokedAt *time.Time) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := env.PG.DB.ExecContext(ctx, `
		INSERT INTO access_tickets (id, tenant_id, public_id, episode_id, user_id, expires_at, revoked_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, uuid.Must(uuid.NewV7()), tenantID, publicID, episodeID, userID, expiresAt, revokedAt); err != nil {
		t.Fatalf("insert access ticket %s: %v", publicID, err)
	}
}

// execSQL runs one statement as the superuser, for the grant states no seed
// helper writes.
func execSQL(t *testing.T, env *publicDBEnv, query string, args ...any) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := env.PG.DB.ExecContext(ctx, query, args...); err != nil {
		t.Fatalf("exec %q: %v", query, err)
	}
}

func TestDBGetSeriesEpisodeAccessAgreesWithGetEpisodeDetail(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Series", Published: true})
	reader := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	other := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0002", "other@tenant-a.example.com", "Other")

	now := time.Now()
	past := now.Add(-time.Hour)
	future := now.Add(time.Hour)

	seed := func(publicID string, orderIndex int32, price int32) testutil.Episode {
		episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
			PublicID:   publicID,
			Title:      publicID,
			OrderIndex: orderIndex,
			Status:     testutil.EpisodeStatusPublished,
			Price:      price,
		})
		env.PG.SeedEpisodeImage(t, tenant.ID, episode.ID, 1)
		return episode
	}

	free := seed("EPFREE000001", 1, 0)
	window := seed("EPWINDOW0001", 2, 500)
	env.PG.SeedEpisodeFreeWindow(t, tenant.ID, window.ID, past, future)
	purchased := seed("EPBOUGHT0001", 3, 500)
	env.PG.SeedPurchase(t, tenant.ID, reader.ID, purchased.ID, 500)
	expiredPurchase := seed("EPEXPIRED001", 4, 500)
	env.PG.SeedPurchase(t, tenant.ID, reader.ID, expiredPurchase.ID, 500)
	execSQL(t, env, `UPDATE purchases SET expires_at = $1 WHERE episode_id = $2`, past, expiredPurchase.ID)
	refunded := seed("EPREFUND0001", 5, 500)
	env.PG.SeedPurchase(t, tenant.ID, reader.ID, refunded.ID, 500)
	execSQL(t, env, `UPDATE purchases SET refunded_amount = price_at_purchase, refunded_at = NOW() WHERE episode_id = $1`, refunded.ID)
	ticketed := seed("EPTICKET0001", 6, 500)
	seedAccessTicket(t, env, tenant.ID, "TICKETLIVE01", ticketed.ID, reader.ID, &future, nil)
	expiredTicket := seed("EPTICKEXP001", 7, 500)
	seedAccessTicket(t, env, tenant.ID, "TICKETEXPR01", expiredTicket.ID, reader.ID, &past, nil)
	revokedTicket := seed("EPTICKREV001", 8, 500)
	seedAccessTicket(t, env, tenant.ID, "TICKETREVK01", revokedTicket.ID, reader.ID, nil, &past)
	othersPurchase := seed("EPOTHERS0001", 9, 500)
	env.PG.SeedPurchase(t, tenant.ID, other.ID, othersPurchase.ID, 500)
	// A draft is no episode of the series to anyone.
	env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID:   "EPDRAFT00001",
		Title:      "Draft",
		OrderIndex: 10,
		Status:     testutil.EpisodeStatusDraft,
		Price:      500,
	})

	want := map[string]map[string]publirav1.EpisodeAccess{
		"guest": {
			free.PublicID:            publirav1.EpisodeAccess_EPISODE_ACCESS_FREE,
			window.PublicID:          publirav1.EpisodeAccess_EPISODE_ACCESS_FREE,
			purchased.PublicID:       publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED,
			expiredPurchase.PublicID: publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED,
			refunded.PublicID:        publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED,
			ticketed.PublicID:        publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED,
			expiredTicket.PublicID:   publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED,
			revokedTicket.PublicID:   publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED,
			othersPurchase.PublicID:  publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED,
		},
		"reader": {
			free.PublicID:            publirav1.EpisodeAccess_EPISODE_ACCESS_FREE,
			window.PublicID:          publirav1.EpisodeAccess_EPISODE_ACCESS_FREE,
			purchased.PublicID:       publirav1.EpisodeAccess_EPISODE_ACCESS_ENTITLED,
			expiredPurchase.PublicID: publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED,
			refunded.PublicID:        publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED,
			ticketed.PublicID:        publirav1.EpisodeAccess_EPISODE_ACCESS_ENTITLED,
			expiredTicket.PublicID:   publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED,
			revokedTicket.PublicID:   publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED,
			othersPurchase.PublicID:  publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED,
		},
	}
	order := []string{
		free.PublicID, window.PublicID, purchased.PublicID, expiredPurchase.PublicID, refunded.PublicID,
		ticketed.PublicID, expiredTicket.PublicID, revokedTicket.PublicID, othersPurchase.PublicID,
	}

	catalog := env.catalogClient()
	for _, caller := range []string{"guest", "reader"} {
		t.Run(caller, func(t *testing.T) {
			withCaller := func(req *connect.Request[publirav1.GetSeriesEpisodeAccessRequest]) *connect.Request[publirav1.GetSeriesEpisodeAccessRequest] {
				if caller == "reader" {
					return newBearerRequest(req.Msg, tokenFor(t, tenant, reader))
				}
				return req
			}
			resp, err := catalog.GetSeriesEpisodeAccess(context.Background(), withCaller(connect.NewRequest(&publirav1.GetSeriesEpisodeAccessRequest{
				Tenant:         tenantContext(tenant),
				SeriesPublicId: series.PublicID,
			})))
			if err != nil {
				t.Fatalf("GetSeriesEpisodeAccess: %v", err)
			}
			if got := resp.Header().Get("Cache-Control"); got != "private, no-store" {
				t.Errorf("Cache-Control = %q, want private, no-store", got)
			}
			if len(resp.Msg.Episodes) != len(order) {
				t.Fatalf("episodes = %d, want %d", len(resp.Msg.Episodes), len(order))
			}
			for i, entry := range resp.Msg.Episodes {
				if entry.EpisodePublicId != order[i] {
					t.Fatalf("episode %d = %s, want %s", i, entry.EpisodePublicId, order[i])
				}
				if entry.Access != want[caller][entry.EpisodePublicId] {
					t.Errorf("%s access = %v, want %v", entry.EpisodePublicId, entry.Access, want[caller][entry.EpisodePublicId])
				}

				detailReq := connect.NewRequest(&publirav1.GetEpisodeDetailRequest{Tenant: tenantContext(tenant), PublicId: entry.EpisodePublicId})
				if caller == "reader" {
					detailReq = newBearerRequest(detailReq.Msg, tokenFor(t, tenant, reader))
				}
				detail, err := catalog.GetEpisodeDetail(context.Background(), detailReq)
				if err != nil {
					t.Fatalf("GetEpisodeDetail %s: %v", entry.EpisodePublicId, err)
				}
				if detail.Msg.Access != entry.Access {
					t.Errorf("%s: series access %v disagrees with episode detail %v", entry.EpisodePublicId, entry.Access, detail.Msg.Access)
				}
			}
		})
	}
}

func TestDBGetSeriesEpisodeAccessAppliesTheTenantAgeRule(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	setTenantAgeVerification(t, env, tenant.ID, ageverification.R18)
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:  "SERIESA00001",
		Title:     "Rated Series",
		Published: true,
		AgeRating: ageverification.RatingR18,
	})
	bought := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPBOUGHT0001",
		Title:    "Bought",
		Status:   testutil.EpisodeStatusPublished,
		Price:    500,
	})
	young := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "young@tenant-a.example.com", "Young")
	setBirthDate(t, env, young.ID, birthDateForAge(t, tenant, 18, true))
	env.PG.SeedPurchase(t, tenant.ID, young.ID, bought.ID, 500)
	adult := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0002", "adult@tenant-a.example.com", "Adult")
	setBirthDate(t, env, adult.ID, birthDateForAge(t, tenant, 18, false))
	env.PG.SeedPurchase(t, tenant.ID, adult.ID, bought.ID, 500)

	tests := []struct {
		name   string
		reader *testutil.TenantUser
		want   publirav1.EpisodeAccess
	}{
		{name: "a guest is stopped", want: publirav1.EpisodeAccess_EPISODE_ACCESS_AGE_RESTRICTED},
		{name: "a purchase does not prove an age", reader: &young, want: publirav1.EpisodeAccess_EPISODE_ACCESS_AGE_RESTRICTED},
		{name: "an old enough buyer is entitled", reader: &adult, want: publirav1.EpisodeAccess_EPISODE_ACCESS_ENTITLED},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := connect.NewRequest(&publirav1.GetSeriesEpisodeAccessRequest{
				Tenant:         tenantContext(tenant),
				SeriesPublicId: series.PublicID,
			})
			if tt.reader != nil {
				req = newBearerRequest(req.Msg, tokenFor(t, tenant, *tt.reader))
			}
			resp, err := env.catalogClient().GetSeriesEpisodeAccess(context.Background(), req)
			if err != nil {
				t.Fatalf("GetSeriesEpisodeAccess: %v", err)
			}
			if len(resp.Msg.Episodes) != 1 || resp.Msg.Episodes[0].Access != tt.want {
				t.Fatalf("episodes = %v, want one %v", resp.Msg.Episodes, tt.want)
			}
		})
	}
}

func TestDBGetSeriesEpisodeAccessHidesSeriesTheStorefrontDoesNot(t *testing.T) {
	env := newPublicDBEnv(t)
	tenantA, tenantB := env.seedTwoTenants(t)
	env.PG.SeedSeries(t, tenantA.ID, testutil.SeriesSeed{PublicID: "SERIESDRAFT1", Title: "Draft", Published: false})
	foreign := env.PG.SeedSeries(t, tenantB.ID, testutil.SeriesSeed{PublicID: "SERIESB00001", Title: "Foreign", Published: true})

	for _, publicID := range []string{"SERIESDRAFT1", foreign.PublicID, "SERIESNONE01"} {
		_, err := env.catalogClient().GetSeriesEpisodeAccess(context.Background(), connect.NewRequest(&publirav1.GetSeriesEpisodeAccessRequest{
			Tenant:         tenantContext(tenantA),
			SeriesPublicId: publicID,
		}))
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Errorf("%s: code = %v, want not_found", publicID, connect.CodeOf(err))
		}
	}
}

func TestDBGetSeriesEpisodeAccessAnswersAnUnverifiableBearerAsAGuest(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Series", Published: true})
	env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPPAID000001",
		Title:    "Paid",
		Status:   testutil.EpisodeStatusPublished,
		Price:    500,
	})

	resp, err := env.catalogClient().GetSeriesEpisodeAccess(context.Background(), newBearerRequest(&publirav1.GetSeriesEpisodeAccessRequest{
		Tenant:         tenantContext(tenant),
		SeriesPublicId: series.PublicID,
	}, "not-a-valid-jwt"))
	if err != nil {
		t.Fatalf("GetSeriesEpisodeAccess: %v", err)
	}
	if len(resp.Msg.Episodes) != 1 || resp.Msg.Episodes[0].Access != publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED {
		t.Fatalf("episodes = %v, want one locked", resp.Msg.Episodes)
	}
}
