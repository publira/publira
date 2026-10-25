package imageserver

import (
	"net/http"
	"net/url"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/testutil"
)

// The media token GetEpisodeDetail hands a subscriber opens the pages of a
// paid episode in the plan's scope here too, because both read the grant from
// the same view. A subscription to a plan of another series, and one whose
// period has ended, are refused.
func TestDBEpisodeImageServesSubscribers(t *testing.T) {
	env := newPreviewDBEnv(t)
	series := env.pg.SeedSeries(t, env.tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Paid Series", Published: true})
	other := env.pg.SeedSeries(t, env.tenant.ID, testutil.SeriesSeed{PublicID: "SERIESB00001", Title: "Other Series", Published: true})
	episode := env.pg.SeedEpisode(t, env.tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEPAY01",
		Title:    "Paid",
		Status:   testutil.EpisodeStatusPublished,
		Price:    500,
	})
	page := env.seedPage(t, episode.ID, 1)
	inScope := env.pg.SeedSubscriptionPlan(t, env.tenant.ID, testutil.SubscriptionPlanSeed{Scope: "series", SeriesIDs: []uuid.UUID{series.ID}})
	outOfScope := env.pg.SeedSubscriptionPlan(t, env.tenant.ID, testutil.SubscriptionPlanSeed{Scope: "series", SeriesIDs: []uuid.UUID{other.ID}})

	for _, tt := range []struct {
		publicID  string
		plan      testutil.SubscriptionPlan
		periodEnd time.Time
		want      int
	}{
		{publicID: "SUBSCRIBER01", plan: inScope, want: http.StatusOK},
		{publicID: "SUBSCRIBER02", plan: outOfScope, want: http.StatusForbidden},
		{publicID: "SUBSCRIBER03", plan: inScope, periodEnd: time.Now().Add(-time.Hour), want: http.StatusForbidden},
	} {
		t.Run(tt.publicID, func(t *testing.T) {
			user := env.pg.SeedEndUser(t, env.tenant.ID, tt.publicID, tt.publicID+"@tenant-a.example.com", tt.publicID)
			env.pg.SeedSubscription(t, env.tenant.ID, user.ID, tt.plan.ID, testutil.SubscriptionSeed{CurrentPeriodEnd: tt.periodEnd})
			token, _, err := testutil.TokenManager().IssueMediaToken(user.PublicID, env.tenant.ID.String(), episode.ID.String(), user.CredentialsVersion, time.Now())
			if err != nil {
				t.Fatalf("IssueMediaToken: %v", err)
			}
			rec := env.get(t, "/images/episodes/"+page.String()+"?"+auth.MediaTokenQueryParam+"="+url.QueryEscape(token))
			if rec.Code != tt.want {
				t.Fatalf("status = %d, want %d (body = %q)", rec.Code, tt.want, rec.Body.String())
			}
		})
	}
}
