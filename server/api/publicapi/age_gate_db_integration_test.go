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

// The age rule is three stored values meeting a fourth — the rating on the
// series — and then a date compared against the tenant's own calendar day.
// Only a real database puts all four in front of the handler at once, so the
// branches are driven here rather than replayed from canned rows.

// setTenantAgeVerification writes the rule the console would have saved. The
// superuser connection, so the row exists before any reader looks at it.
func setTenantAgeVerification(t *testing.T, env *publicDBEnv, tenantID uuid.UUID, rule string) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := env.PG.DB.ExecContext(ctx, `
		INSERT INTO tenant_config (tenant_id, age_verification)
		VALUES ($1, $2)
		ON CONFLICT (tenant_id) DO UPDATE SET age_verification = EXCLUDED.age_verification
	`, tenantID, rule); err != nil {
		t.Fatalf("set age_verification = %q: %v", rule, err)
	}
}

// setBirthDate writes the date the reader gave, as UpdateMe would have.
func setBirthDate(t *testing.T, env *publicDBEnv, userID uuid.UUID, birthDate time.Time) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := env.PG.DB.ExecContext(ctx,
		"UPDATE users SET birth_date = $2 WHERE id = $1", userID, birthDate,
	); err != nil {
		t.Fatalf("set birth_date: %v", err)
	}
}

// birthDateForAge is the birth date of someone who is exactly age years old on
// the tenant's calendar day today, and one day short of it when notYet is set.
func birthDateForAge(t *testing.T, tenant testutil.Tenant, age int, notYet bool) time.Time {
	t.Helper()

	location, err := time.LoadLocation(tenant.TimeZone)
	if err != nil {
		t.Fatalf("load tenant time zone %q: %v", tenant.TimeZone, err)
	}
	born := ageverification.Today(time.Now(), location).AddDate(-age, 0, 0)
	if notYet {
		born = born.AddDate(0, 0, 1)
	}
	return born
}

func TestDBGetEpisodeDetailAppliesTheTenantAgeRule(t *testing.T) {
	tests := []struct {
		name string
		rule string
		// rating is the series' own age_rating.
		rating string
		// signedIn seeds a reader and sends the request as them; a guest sends
		// no bearer at all.
		signedIn bool
		// age is how old that reader is today, and 0 with hasBirthDate unset
		// means an account that has never given a date.
		hasBirthDate bool
		age          int
		// oneDayShort makes the reader a day short of that birthday.
		oneDayShort bool
		want        publirav1.EpisodeAccess
	}{
		{
			name:   "a tenant verifying nothing opens a rated body to a guest",
			rule:   ageverification.None,
			rating: ageverification.RatingR18,
			want:   publirav1.EpisodeAccess_EPISODE_ACCESS_FREE,
		},
		{
			name:   "a guest cannot open a body the rule covers",
			rule:   ageverification.R18,
			rating: ageverification.RatingR18,
			want:   publirav1.EpisodeAccess_EPISODE_ACCESS_AGE_RESTRICTED,
		},
		{
			name:     "a reader who has given no birth date cannot either",
			rule:     ageverification.R18,
			rating:   ageverification.RatingR18,
			signedIn: true,
			want:     publirav1.EpisodeAccess_EPISODE_ACCESS_AGE_RESTRICTED,
		},
		{
			name:         "a reader a day short of eighteen cannot",
			rule:         ageverification.R18,
			rating:       ageverification.RatingR18,
			signedIn:     true,
			hasBirthDate: true,
			age:          18,
			oneDayShort:  true,
			want:         publirav1.EpisodeAccess_EPISODE_ACCESS_AGE_RESTRICTED,
		},
		{
			name:         "a reader eighteen today can",
			rule:         ageverification.R18,
			rating:       ageverification.RatingR18,
			signedIn:     true,
			hasBirthDate: true,
			age:          18,
			want:         publirav1.EpisodeAccess_EPISODE_ACCESS_FREE,
		},
		{
			name:   "the r18 rule leaves an r15 series to the client's confirmation",
			rule:   ageverification.R18,
			rating: ageverification.RatingR15,
			want:   publirav1.EpisodeAccess_EPISODE_ACCESS_FREE,
		},
		{
			name:   "the wider rule covers r15 as well",
			rule:   ageverification.R15AndR18,
			rating: ageverification.RatingR15,
			want:   publirav1.EpisodeAccess_EPISODE_ACCESS_AGE_RESTRICTED,
		},
		{
			name:         "a reader fifteen today clears an r15 series",
			rule:         ageverification.R15AndR18,
			rating:       ageverification.RatingR15,
			signedIn:     true,
			hasBirthDate: true,
			age:          15,
			want:         publirav1.EpisodeAccess_EPISODE_ACCESS_FREE,
		},
		{
			name:         "a reader fifteen today is still short of an r18 series",
			rule:         ageverification.R15AndR18,
			rating:       ageverification.RatingR18,
			signedIn:     true,
			hasBirthDate: true,
			age:          15,
			want:         publirav1.EpisodeAccess_EPISODE_ACCESS_AGE_RESTRICTED,
		},
		{
			name:   "an unrated series asks nothing of anyone",
			rule:   ageverification.R15AndR18,
			rating: ageverification.RatingAll,
			want:   publirav1.EpisodeAccess_EPISODE_ACCESS_FREE,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			env := newPublicDBEnv(t)
			tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
			setTenantAgeVerification(t, env, tenant.ID, tt.rule)
			series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
				PublicID:  "SERIESA00001",
				Title:     "Rated Series",
				Published: true,
				AgeRating: tt.rating,
			})
			// Free, so nothing but the age rule can withhold the body.
			episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
				PublicID: "EPISODEAGE01",
				Title:    "Rated Episode",
				Status:   testutil.EpisodeStatusPublished,
			})
			env.PG.SeedEpisodeImage(t, tenant.ID, episode.ID, 1)

			request := connect.NewRequest(&publirav1.GetEpisodeDetailRequest{
				Tenant:   tenantContext(tenant),
				PublicId: episode.PublicID,
			})
			if tt.signedIn {
				reader := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
				if tt.hasBirthDate {
					setBirthDate(t, env, reader.ID, birthDateForAge(t, tenant, tt.age, tt.oneDayShort))
				}
				request = newBearerRequest(request.Msg, tokenFor(t, tenant, reader))
			}

			resp, err := env.catalogClient().GetEpisodeDetail(context.Background(), request)
			if err != nil {
				t.Fatalf("GetEpisodeDetail: %v", err)
			}
			if resp.Msg.Access != tt.want {
				t.Fatalf("access = %v, want %v", resp.Msg.Access, tt.want)
			}
			// A withheld body carries no images, exactly as a locked one does.
			wantImages := 1
			if tt.want == publirav1.EpisodeAccess_EPISODE_ACCESS_AGE_RESTRICTED {
				wantImages = 0
			}
			if len(resp.Msg.Images) != wantImages {
				t.Fatalf("images = %d, want %d", len(resp.Msg.Images), wantImages)
			}
		})
	}
}

// Buying an episode is not proof of an age. A reader the rule stops is stopped
// on a body they have already paid for.
func TestDBGetEpisodeDetailAgeRuleOutranksAPurchase(t *testing.T) {
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
	reader := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	env.PG.SeedPurchase(t, tenant.ID, reader.ID, episode.ID, 500)

	resp, err := env.catalogClient().GetEpisodeDetail(context.Background(), newBearerRequest(
		&publirav1.GetEpisodeDetailRequest{Tenant: tenantContext(tenant), PublicId: episode.PublicID},
		tokenFor(t, tenant, reader),
	))
	if err != nil {
		t.Fatalf("GetEpisodeDetail: %v", err)
	}
	if resp.Msg.Access != publirav1.EpisodeAccess_EPISODE_ACCESS_AGE_RESTRICTED {
		t.Fatalf("access = %v, want age restricted", resp.Msg.Access)
	}
	if len(resp.Msg.Images) != 0 {
		t.Fatalf("images = %d, want none", len(resp.Msg.Images))
	}

	// The same reader, once they have proven the age, gets the body the
	// purchase entitles them to.
	setBirthDate(t, env, reader.ID, birthDateForAge(t, tenant, 18, false))
	entitled, err := env.catalogClient().GetEpisodeDetail(context.Background(), newBearerRequest(
		&publirav1.GetEpisodeDetailRequest{Tenant: tenantContext(tenant), PublicId: episode.PublicID},
		tokenFor(t, tenant, reader),
	))
	if err != nil {
		t.Fatalf("GetEpisodeDetail after the birth date: %v", err)
	}
	if entitled.Msg.Access != publirav1.EpisodeAccess_EPISODE_ACCESS_ENTITLED {
		t.Fatalf("access = %v, want entitled", entitled.Msg.Access)
	}
	if len(entitled.Msg.Images) != 1 {
		t.Fatalf("images = %d, want 1", len(entitled.Msg.Images))
	}
}

// The series detail says what the rule asks of the series and nothing about
// the reader, so it stays one shared answer.
func TestDBGetSeriesDetailReportsTheRequiredMinimumAge(t *testing.T) {
	tests := []struct {
		name   string
		rule   string
		rating string
		want   int32
	}{
		{name: "a tenant verifying nothing", rule: ageverification.None, rating: ageverification.RatingR18, want: 0},
		{name: "an unrated series", rule: ageverification.R15AndR18, rating: ageverification.RatingAll, want: 0},
		{name: "r15 under the r18 rule", rule: ageverification.R18, rating: ageverification.RatingR15, want: 0},
		{name: "r15 under the wider rule", rule: ageverification.R15AndR18, rating: ageverification.RatingR15, want: 15},
		{name: "r18 under the r18 rule", rule: ageverification.R18, rating: ageverification.RatingR18, want: 18},
		{name: "r18 under the wider rule", rule: ageverification.R15AndR18, rating: ageverification.RatingR18, want: 18},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			env := newPublicDBEnv(t)
			tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
			setTenantAgeVerification(t, env, tenant.ID, tt.rule)
			series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
				PublicID:  "SERIESA00001",
				Title:     "Rated Series",
				Published: true,
				AgeRating: tt.rating,
			})

			resp, err := env.catalogClient().GetSeriesDetail(context.Background(), connect.NewRequest(
				&publirav1.GetSeriesDetailRequest{Tenant: tenantContext(tenant), PublicId: series.PublicID},
			))
			if err != nil {
				t.Fatalf("GetSeriesDetail: %v", err)
			}
			if resp.Msg.RequiredMinimumAge != tt.want {
				t.Fatalf("required_minimum_age = %d, want %d", resp.Msg.RequiredMinimumAge, tt.want)
			}
		})
	}
}
