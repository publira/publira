package publicapi

import (
	"context"
	"testing"

	"github.com/publira/publira/server/internal/ageverification"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// A reader linked to a creator the episode credits opens it as an entitled
// one, with images whose token names them. The credit that counts is the
// episode's own: one only the series carries opens nothing.
func TestDBGetEpisodeDetailOpensACreditedCreatorsOwnEpisode(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Paid Series", Published: true})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEPAY01",
		Title:    "Paid Chapter",
		Status:   testutil.EpisodeStatusPublished,
		Price:    500,
	})
	env.PG.SeedEpisodeImage(t, tenant.ID, episode.ID, 1)

	credited := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{Name: "Credited"})
	env.PG.SeedSeriesCreator(t, tenant.ID, series.ID, credited.ID, "")
	env.PG.SeedEpisodeCreator(t, tenant.ID, episode.ID, credited.ID, "")
	seriesOnly := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{Name: "Series Only"})
	env.PG.SeedSeriesCreator(t, tenant.ID, series.ID, seriesOnly.ID, "")
	uncredited := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{Name: "Uncredited"})

	creatorAccount := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERCRE01", "creator@tenant-a.example.com", "Creator Account")
	env.PG.SeedCreatorAccount(t, tenant.ID, credited.ID, creatorAccount.ID)
	seriesCreatorAccount := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERSER01", "series@tenant-a.example.com", "Series Creator Account")
	env.PG.SeedCreatorAccount(t, tenant.ID, seriesOnly.ID, seriesCreatorAccount.ID)
	stranger := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERSTR01", "stranger@tenant-a.example.com", "Stranger")
	env.PG.SeedCreatorAccount(t, tenant.ID, uncredited.ID, stranger.ID)

	client := env.catalogClient()
	detail := func(t *testing.T, user testutil.TenantUser) *publirav1.GetEpisodeDetailResponse {
		t.Helper()
		resp, err := client.GetEpisodeDetail(context.Background(), newBearerRequest(
			&publirav1.GetEpisodeDetailRequest{Tenant: tenantContext(tenant), PublicId: episode.PublicID},
			tokenFor(t, tenant, user),
		))
		if err != nil {
			t.Fatalf("GetEpisodeDetail: %v", err)
		}
		return resp.Msg
	}

	t.Run("the credited creator's account", func(t *testing.T) {
		got := detail(t, creatorAccount)
		if got.Access != publirav1.EpisodeAccess_EPISODE_ACCESS_ENTITLED {
			t.Fatalf("access = %v, want entitled", got.Access)
		}
		if got.EntitlementSource != publirav1.EpisodeEntitlementSource_EPISODE_ENTITLEMENT_SOURCE_CREATOR {
			t.Fatalf("entitlement source = %v, want creator", got.EntitlementSource)
		}
		if len(got.Images) != 1 {
			t.Fatalf("images = %d, want 1", len(got.Images))
		}
		if subject := mediaTokenSubject(t, got.Images[0].ImageUrl); subject != creatorAccount.PublicID {
			t.Fatalf("media token subject = %q, want the creator's account %q", subject, creatorAccount.PublicID)
		}

		access, err := client.GetSeriesEpisodeAccess(context.Background(), newBearerRequest(
			&publirav1.GetSeriesEpisodeAccessRequest{Tenant: tenantContext(tenant), SeriesId: series.ID.String()},
			tokenFor(t, tenant, creatorAccount),
		))
		if err != nil {
			t.Fatalf("GetSeriesEpisodeAccess: %v", err)
		}
		if len(access.Msg.Episodes) != 1 || access.Msg.Episodes[0].Access != publirav1.EpisodeAccess_EPISODE_ACCESS_ENTITLED {
			t.Fatalf("series episode access = %v, want the episode entitled", access.Msg.Episodes)
		}
	})

	for _, tt := range []struct {
		name string
		user testutil.TenantUser
	}{
		{name: "an account linked to a creator only the series credits", user: seriesCreatorAccount},
		{name: "an account linked to a creator nothing credits", user: stranger},
	} {
		t.Run(tt.name, func(t *testing.T) {
			got := detail(t, tt.user)
			if got.Access != publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED {
				t.Fatalf("access = %v, want locked", got.Access)
			}
			if got.EntitlementSource != publirav1.EpisodeEntitlementSource_EPISODE_ENTITLEMENT_SOURCE_UNSPECIFIED {
				t.Fatalf("entitlement source = %v, want unspecified", got.EntitlementSource)
			}
			if len(got.Images) != 0 {
				t.Fatalf("images = %d, want none", len(got.Images))
			}
		})
	}
}

// Being a credited creator is not proof of an age any more than a purchase is.
func TestDBGetEpisodeDetailAgeRuleOutranksTheCreatorGrant(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	setTenantAgeVerification(t, env, tenant.ID, ageverification.R18)
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:  "SERIESA00001",
		Title:     "Rated Series",
		Published: true,
		AgeRating: ageverification.RatingR18,
	})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEAGE01",
		Title:    "Rated Episode",
		Status:   testutil.EpisodeStatusPublished,
		Price:    500,
	})
	env.PG.SeedEpisodeImage(t, tenant.ID, episode.ID, 1)
	creator := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{Name: "Credited"})
	env.PG.SeedEpisodeCreator(t, tenant.ID, episode.ID, creator.ID, "")
	creatorAccount := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERCRE01", "creator@tenant-a.example.com", "Creator Account")
	env.PG.SeedCreatorAccount(t, tenant.ID, creator.ID, creatorAccount.ID)

	resp, err := env.catalogClient().GetEpisodeDetail(context.Background(), newBearerRequest(
		&publirav1.GetEpisodeDetailRequest{Tenant: tenantContext(tenant), PublicId: episode.PublicID},
		tokenFor(t, tenant, creatorAccount),
	))
	if err != nil {
		t.Fatalf("GetEpisodeDetail: %v", err)
	}
	if resp.Msg.Access != publirav1.EpisodeAccess_EPISODE_ACCESS_AGE_RESTRICTED {
		t.Fatalf("access = %v, want age restricted", resp.Msg.Access)
	}
	if resp.Msg.EntitlementSource != publirav1.EpisodeEntitlementSource_EPISODE_ENTITLEMENT_SOURCE_UNSPECIFIED {
		t.Fatalf("entitlement source = %v, want unspecified", resp.Msg.EntitlementSource)
	}
	if len(resp.Msg.Images) != 0 {
		t.Fatalf("images = %d, want none", len(resp.Msg.Images))
	}
}
