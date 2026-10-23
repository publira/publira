package imageserver

import (
	"net/http"
	"net/url"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/testutil"
)

// The media token GetEpisodeDetail hands a member of staff opens the pages of
// a paid episode here too, because both read the grant from the same view. A
// reader with no role, or with a role string outside the three, is refused.
func TestDBEpisodeImageServesTenantStaff(t *testing.T) {
	env := newPreviewDBEnv(t)
	series := env.pg.SeedSeries(t, env.tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Paid Series", Published: true})
	episode := env.pg.SeedEpisode(t, env.tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEPAY01",
		Title:    "Paid",
		Status:   testutil.EpisodeStatusPublished,
		Price:    500,
	})
	page := env.seedPage(t, episode.ID, 1)

	for _, tt := range []struct {
		publicID string
		role     string
		want     int
	}{
		{publicID: "STAFFADMIN01", role: auth.RoleTenantAdmin, want: http.StatusOK},
		{publicID: "STAFFEDITR01", role: auth.RoleTenantEditor, want: http.StatusOK},
		{publicID: "STAFFAUDIT01", role: auth.RoleTenantAuditor, want: http.StatusOK},
		{publicID: "ENDUSERREA01", want: http.StatusForbidden},
		{publicID: "ENDUSERUNK01", role: "tenant_owner", want: http.StatusForbidden},
	} {
		t.Run(tt.publicID, func(t *testing.T) {
			user := env.pg.SeedEndUser(t, env.tenant.ID, tt.publicID, tt.publicID+"@tenant-a.example.com", tt.publicID)
			if tt.role != "" {
				env.pg.SeedTenantUserRole(t, env.tenant.ID, user.ID, tt.role)
			}
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
