package publicapi

import (
	"context"
	"log/slog"
	"net/http/httptest"
	"testing"

	"connectrpc.com/connect"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/mailguard"
	"github.com/publira/publira/server/internal/platformpolicy"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/ratelimit"
	"github.com/publira/publira/server/internal/testutil"
)

// newPublicDBEnvWithSavedPolicy saves policy as the platform's and starts a
// server whose flood controls resolve it the way production does: through the
// publira_public pool. Only the counters are this test's own.
func newPublicDBEnvWithSavedPolicy(t *testing.T, policy platformpolicy.Policy) *publicDBEnv {
	t.Helper()

	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	pg.SavePlatformPolicy(t, policy)
	db := pg.OpenPublicDB(t)

	resolver := platformpolicy.NewResolver(dbmodels.New(db), platformpolicy.CacheTTL, slog.Default())
	guards := readerGuards{limiter: ratelimit.New(ratelimit.NewMemoryStore()), policy: resolver}
	mail := mailguard.New(ratelimit.New(ratelimit.NewMemoryStore()), resolver, slog.Default())
	server := httptest.NewServer(handlerFromServer(
		newAPIServer(db, dbmodels.New(db), nil, testutil.TokenManager(), slog.Default(), guards, mail),
	))
	t.Cleanup(server.Close)
	return &publicDBEnv{Server: server, PG: pg}
}

// The limits an operator saves are the ones a reader meets.
func TestDBSavedPlatformPolicyLimitsCommentPosting(t *testing.T) {
	policy := openPolicy()
	policy.Community.CommentPost = platformpolicy.MinuteDay{PerMinute: 1, PerDay: 1}
	env := newPublicDBEnvWithSavedPolicy(t, policy)
	tenant := env.seedTenant(t, "POLTENANT", "policy.example.com", "Policy Tenant")
	member := env.PG.SeedEndUser(t, tenant.ID, "POLMEMBER", "policy-member@example.com", "Policy Member")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "POLSERIES", Title: "Policy series", Published: true})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "POLEPISODE", Title: "Policy episode", Status: testutil.EpisodeStatusPublished})
	env.setCommentMode(t, tenant.ID, "immediate")

	env.mustPostComment(t, tenant, member, episode.PublicID, "The one comment the policy allows.")
	if _, err := env.postComment(t, tenant, member, episode.PublicID, "And one more."); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("the post past the saved limit error = %v, want resource_exhausted", err)
	}
}

func TestDBSavedPlatformPolicyLimitsMailRequests(t *testing.T) {
	policy := openPolicy()
	policy.MailRequestsPerAddress = platformpolicy.HourDay{PerHour: 1, PerDay: 1}
	env := newPublicDBEnvWithSavedPolicy(t, policy)
	tenant := env.seedTenant(t, "POLTENANT", "policy.example.com", "Policy Tenant")
	member := env.PG.SeedEndUser(t, tenant.ID, "POLMEMBER", "policy-member@example.com", "Policy Member")

	reset := func() error {
		_, err := env.authClient().RequestPasswordReset(context.Background(), connect.NewRequest(&publirav1.RequestPasswordResetRequest{
			Tenant: tenantContext(tenant),
			Email:  member.Email,
		}))
		return err
	}
	if err := reset(); err != nil {
		t.Fatalf("the first RequestPasswordReset: %v", err)
	}
	if err := reset(); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("the second RequestPasswordReset = %v, want resource_exhausted", err)
	}
}

// An installation that has saved nothing enforces the built-in defaults.
func TestDBUnsavedPlatformPolicyEnforcesTheDefaults(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	db := pg.OpenPublicDB(t)

	resolver := platformpolicy.NewResolver(dbmodels.New(db), platformpolicy.CacheTTL, slog.Default())
	policy, err := resolver.Policy(context.Background())
	if err != nil {
		t.Fatalf("resolve the policy as publira_public: %v", err)
	}
	if policy != platformpolicy.Defaults() {
		t.Fatalf("policy = %+v, want the built-in defaults", policy)
	}
}
