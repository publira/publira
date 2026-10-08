package publicapi

import (
	"context"
	"errors"
	"slices"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connectproto"
	"github.com/google/uuid"
	"google.golang.org/genproto/googleapis/rpc/errdetails"

	"github.com/publira/publira/server/internal/ageverification"
	"github.com/publira/publira/server/internal/platformpolicy"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/testutil"
)

// setSeriesWaitFree stores a series' wait-for-free rule the way the console
// saves one.
func setSeriesWaitFree(t *testing.T, env *publicDBEnv, tenantID, seriesID uuid.UUID, enabled bool, rechargeHours, accessHours, excludedLatestCount int32) {
	t.Helper()

	execSQL(t, env, `
		INSERT INTO series_wait_free_settings (tenant_id, series_id, enabled, recharge_hours, access_hours, excluded_latest_count)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (series_id) DO UPDATE
		SET enabled = EXCLUDED.enabled,
			recharge_hours = EXCLUDED.recharge_hours,
			access_hours = EXCLUDED.access_hours,
			excluded_latest_count = EXCLUDED.excluded_latest_count
	`, tenantID, seriesID, enabled, rechargeHours, accessHours, excludedLatestCount)
}

// rechargeWaitFree moves the reader's next ticket on the series to a moment
// ago, which is what the recharge interval passing looks like to every read.
func rechargeWaitFree(t *testing.T, env *publicDBEnv, userID, seriesID uuid.UUID) {
	t.Helper()

	execSQL(t, env, `
		UPDATE wait_free_ticket_states
		SET next_available_at = NOW() - INTERVAL '1 second'
		WHERE user_id = $1 AND series_id = $2
	`, userID, seriesID)
}

// countWaitFreeTickets is how many tickets the reader has used on the episode,
// expired ones included.
func countWaitFreeTickets(t *testing.T, env *publicDBEnv, userID, episodeID uuid.UUID) int {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var count int
	if err := env.PG.DB.QueryRowContext(ctx, `
		SELECT count(*) FROM access_tickets
		WHERE user_id = $1 AND episode_id = $2 AND source = 'wait_free'
	`, userID, episodeID).Scan(&count); err != nil {
		t.Fatalf("count wait-free tickets: %v", err)
	}
	return count
}

// errorInfoReason is the ErrorInfo reason a refusal carries, and "" when it
// carries none.
func errorInfoReason(err error) (string, map[string]string) {
	var connectErr *connect.Error
	if !errors.As(err, &connectErr) {
		return "", nil
	}
	for _, detail := range connectErr.Details() {
		value, valueErr := connectproto.UnmarshalErrorDetail(detail)
		if valueErr != nil {
			continue
		}
		if info, ok := value.(*errdetails.ErrorInfo); ok && info.GetDomain() == rpcerrors.ErrorInfoDomain {
			return info.GetReason(), info.GetMetadata()
		}
	}
	return "", nil
}

// assertWaitFreeRefusal fails unless err carries the code and, when one is
// named, the ErrorInfo reason.
func assertWaitFreeRefusal(t *testing.T, err error, code connect.Code, reason string) {
	t.Helper()

	if connect.CodeOf(err) != code {
		t.Fatalf("code = %v, want %v (err=%v)", connect.CodeOf(err), code, err)
	}
	if got, _ := errorInfoReason(err); got != reason {
		t.Fatalf("reason = %q, want %q (err=%v)", got, reason, err)
	}
}

// assertAround fails unless the RFC3339 instant is within a minute of want.
// Both ends come from the database's clock, so a minute is the time the test
// takes rather than a tolerance for drift.
func assertAround(t *testing.T, what, got string, want time.Time) {
	t.Helper()

	parsed, err := time.Parse(time.RFC3339, got)
	if err != nil {
		t.Fatalf("%s = %q, want an RFC3339 instant: %v", what, got, err)
	}
	if diff := parsed.Sub(want); diff < -time.Minute || diff > time.Minute {
		t.Fatalf("%s = %s, want about %s", what, parsed, want.UTC())
	}
}

type waitFreeFixture struct {
	env      *publicDBEnv
	tenant   testutil.Tenant
	series   testutil.Series
	episodes []testutil.Episode
	reader   testutil.TenantUser
	token    string
}

// newWaitFreeFixture seeds one series of priced, published episodes and a
// reader, with no rule configured yet.
func newWaitFreeFixture(t *testing.T, episodeCount int) waitFreeFixture {
	t.Helper()
	return newWaitFreeFixtureOn(t, newPublicDBEnv(t), episodeCount)
}

func newWaitFreeFixtureOn(t *testing.T, env *publicDBEnv, episodeCount int) waitFreeFixture {
	t.Helper()

	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Series", Published: true})
	episodes := make([]testutil.Episode, 0, episodeCount)
	for index := range episodeCount {
		publicID := "EPISODEA000" + string(rune('1'+index))
		episodes = append(episodes, env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
			PublicID:   publicID,
			Title:      publicID,
			OrderIndex: int32(index + 1),
			Status:     testutil.EpisodeStatusPublished,
			Price:      300,
		}))
	}
	reader := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	return waitFreeFixture{
		env:      env,
		tenant:   tenant,
		series:   series,
		episodes: episodes,
		reader:   reader,
		token:    tokenFor(t, tenant, reader),
	}
}

func (f waitFreeFixture) useTicket(episodeID uuid.UUID) (*publirav1.UseTicketResponse, error) {
	resp, err := f.env.waitFreeClient().UseTicket(testutil.WithBearer(context.Background(), f.token), &publirav1.UseTicketRequest{Tenant: tenantContext(f.tenant), EpisodeId: episodeID.String()})
	if err != nil {
		return nil, err
	}
	return resp, nil
}

func (f waitFreeFixture) ticketState(t *testing.T) *publirav1.GetMyTicketStateResponse {
	t.Helper()

	resp, err := f.env.waitFreeClient().GetMyTicketState(testutil.WithBearer(context.Background(), f.token), &publirav1.GetMyTicketStateRequest{Tenant: tenantContext(f.tenant), SeriesId: f.series.ID.String()})
	if err != nil {
		t.Fatalf("GetMyTicketState: %v", err)
	}
	return resp
}

func (f waitFreeFixture) episodeAccess(t *testing.T, episode testutil.Episode) *publirav1.GetEpisodeDetailResponse {
	t.Helper()

	resp, err := f.env.catalogClient().GetEpisodeDetail(testutil.WithBearer(context.Background(), f.token), &publirav1.GetEpisodeDetailRequest{Tenant: tenantContext(f.tenant), PublicId: episode.PublicID})
	if err != nil {
		t.Fatalf("GetEpisodeDetail: %v", err)
	}
	return resp
}

// A used ticket opens the episode for the access period and starts the
// recharge, and the next one is refused until that recharge has passed.
func TestDBUseTicketOpensTheEpisodeAndWaitsForTheRecharge(t *testing.T) {
	f := newWaitFreeFixture(t, 3)
	setSeriesWaitFree(t, f.env, f.tenant.ID, f.series.ID, true, 23, 72, 0)

	state := f.ticketState(t)
	if state.NextAvailableAt != "" || len(state.OpenTickets) != 0 {
		t.Fatalf("state before any use = %+v, want a ticket ready and none open", state)
	}

	used, err := f.useTicket(f.episodes[0].ID)
	if err != nil {
		t.Fatalf("UseTicket: %v", err)
	}
	now := time.Now()
	if used.Ticket.GetEpisodeId() != f.episodes[0].ID.String() {
		t.Fatalf("ticket episode = %q, want %s", used.Ticket.GetEpisodeId(), f.episodes[0].ID)
	}
	assertAround(t, "expires_at", used.Ticket.GetExpiresAt(), now.Add(72*time.Hour))
	assertAround(t, "next_available_at", used.NextAvailableAt, now.Add(23*time.Hour))

	detail := f.episodeAccess(t, f.episodes[0])
	if detail.Access != publirav1.EpisodeAccess_EPISODE_ACCESS_ENTITLED ||
		detail.EntitlementSource != publirav1.EpisodeEntitlementSource_EPISODE_ENTITLEMENT_SOURCE_ACCESS_TICKET {
		t.Fatalf("episode access = %v (%v), want entitled through an access ticket", detail.Access, detail.EntitlementSource)
	}

	state = f.ticketState(t)
	if state.NextAvailableAt != used.NextAvailableAt {
		t.Fatalf("next_available_at = %q, want %q", state.NextAvailableAt, used.NextAvailableAt)
	}
	if len(state.OpenTickets) != 1 || state.OpenTickets[0].EpisodeId != f.episodes[0].ID.String() ||
		state.OpenTickets[0].ExpiresAt != used.Ticket.ExpiresAt {
		t.Fatalf("open tickets = %v, want the one just used", state.OpenTickets)
	}

	_, err = f.useTicket(f.episodes[1].ID)
	assertWaitFreeRefusal(t, err, connect.CodeFailedPrecondition, rpcerrors.ReasonWaitFreeNotRecharged)
	if _, metadata := errorInfoReason(err); metadata[rpcerrors.MetadataNextAvailableAt] != used.NextAvailableAt {
		t.Fatalf("refusal next_available_at = %q, want %q", metadata[rpcerrors.MetadataNextAvailableAt], used.NextAvailableAt)
	}
	if got := f.episodeAccess(t, f.episodes[1]).Access; got != publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED {
		t.Fatalf("refused episode access = %v, want locked", got)
	}

	rechargeWaitFree(t, f.env, f.reader.ID, f.series.ID)
	if state := f.ticketState(t); state.NextAvailableAt != "" {
		t.Fatalf("next_available_at after the recharge = %q, want a ticket ready", state.NextAvailableAt)
	}
	if _, err := f.useTicket(f.episodes[1].ID); err != nil {
		t.Fatalf("UseTicket after the recharge: %v", err)
	}
	if got := f.episodeAccess(t, f.episodes[1]).Access; got != publirav1.EpisodeAccess_EPISODE_ACCESS_ENTITLED {
		t.Fatalf("second episode access = %v, want entitled", got)
	}
}

// The interval in force when a ticket is used fixes the next one; changing it
// afterwards moves the next use, not the wait already running.
func TestDBUseTicketRechargesByTheIntervalInForceWhenUsed(t *testing.T) {
	f := newWaitFreeFixture(t, 3)
	setSeriesWaitFree(t, f.env, f.tenant.ID, f.series.ID, true, 1, 24, 0)

	first, err := f.useTicket(f.episodes[0].ID)
	if err != nil {
		t.Fatalf("UseTicket: %v", err)
	}
	assertAround(t, "next_available_at", first.NextAvailableAt, time.Now().Add(time.Hour))

	setSeriesWaitFree(t, f.env, f.tenant.ID, f.series.ID, true, 48, 24, 0)
	if state := f.ticketState(t); state.NextAvailableAt != first.NextAvailableAt {
		t.Fatalf("next_available_at after the interval changed = %q, want %q", state.NextAvailableAt, first.NextAvailableAt)
	}

	rechargeWaitFree(t, f.env, f.reader.ID, f.series.ID)
	second, err := f.useTicket(f.episodes[1].ID)
	if err != nil {
		t.Fatalf("UseTicket after the recharge: %v", err)
	}
	assertAround(t, "next_available_at", second.NextAvailableAt, time.Now().Add(48*time.Hour))
}

// Using a ticket twice on the same episode spends one recharge and writes one
// ticket, whether the second call comes after the first or alongside it.
func TestDBUseTicketIsIdempotentPerEpisode(t *testing.T) {
	t.Run("a repeated call", func(t *testing.T) {
		f := newWaitFreeFixture(t, 2)
		setSeriesWaitFree(t, f.env, f.tenant.ID, f.series.ID, true, 23, 72, 0)

		first, err := f.useTicket(f.episodes[0].ID)
		if err != nil {
			t.Fatalf("UseTicket: %v", err)
		}
		_, err = f.useTicket(f.episodes[0].ID)
		assertWaitFreeRefusal(t, err, connect.CodeAlreadyExists, "")

		if got := countWaitFreeTickets(t, f.env, f.reader.ID, f.episodes[0].ID); got != 1 {
			t.Fatalf("wait-free tickets = %d, want 1", got)
		}
		if state := f.ticketState(t); state.NextAvailableAt != first.NextAvailableAt {
			t.Fatalf("next_available_at = %q, want the first call's %q", state.NextAvailableAt, first.NextAvailableAt)
		}
	})

	t.Run("concurrent calls", func(t *testing.T) {
		f := newWaitFreeFixture(t, 3)
		setSeriesWaitFree(t, f.env, f.tenant.ID, f.series.ID, true, 23, 72, 0)

		// Several on one episode, as a client that sent the request twice, and
		// one on each of the others, as a reader racing the recharge.
		targets := []uuid.UUID{f.episodes[0].ID, f.episodes[0].ID, f.episodes[0].ID, f.episodes[1].ID, f.episodes[2].ID}
		errs := make([]error, len(targets))
		var wg sync.WaitGroup
		for index, episodeID := range targets {
			wg.Go(func() {
				_, errs[index] = f.useTicket(episodeID)
			})
		}
		wg.Wait()

		succeeded := 0
		for index, err := range errs {
			switch {
			case err == nil:
				succeeded++
			case connect.CodeOf(err) == connect.CodeAlreadyExists && targets[index] == f.episodes[0].ID:
			case connect.CodeOf(err) == connect.CodeFailedPrecondition:
				if reason, _ := errorInfoReason(err); reason != rpcerrors.ReasonWaitFreeNotRecharged {
					t.Fatalf("call %d reason = %q, want %s", index, reason, rpcerrors.ReasonWaitFreeNotRecharged)
				}
			default:
				t.Fatalf("call %d on %s: %v", index, targets[index], err)
			}
		}
		if succeeded != 1 {
			t.Fatalf("succeeded = %d of %d, want exactly one ticket spent (errs=%v)", succeeded, len(targets), errs)
		}
		total := 0
		for _, episode := range f.episodes {
			total += countWaitFreeTickets(t, f.env, f.reader.ID, episode.ID)
		}
		if total != 1 {
			t.Fatalf("wait-free tickets = %d, want 1", total)
		}
	})
}

// The latest episodes the rule keeps back are refused, counted over the
// published episodes alone, and GetSeriesDetail names the same ones.
func TestDBUseTicketRefusesTheExcludedLatestEpisodes(t *testing.T) {
	f := newWaitFreeFixture(t, 4)
	// A draft after the published four is not one of the latest a reader can see.
	f.env.PG.SeedEpisode(t, f.tenant.ID, f.series.ID, testutil.EpisodeSeed{PublicID: "EPISODEDRAFT", Title: "Draft", OrderIndex: 5, Price: 300})
	setSeriesWaitFree(t, f.env, f.tenant.ID, f.series.ID, true, 23, 72, 2)

	detail, err := f.env.catalogClient().GetSeriesDetail(context.Background(),
		&publirav1.GetSeriesDetailRequest{Tenant: tenantContext(f.tenant), PublicId: f.series.PublicID},
	)
	if err != nil {
		t.Fatalf("GetSeriesDetail: %v", err)
	}
	rule := detail.WaitFree
	if rule == nil || rule.RechargeHours != 23 || rule.AccessHours != 72 || rule.ExcludedLatestCount != 2 {
		t.Fatalf("wait_free = %+v, want 23h recharge, 72h access, 2 excluded", rule)
	}
	if want := []string{f.episodes[2].ID.String(), f.episodes[3].ID.String()}; !slices.Equal(rule.ExcludedEpisodeIds, want) {
		t.Fatalf("excluded_episode_ids = %v, want %v", rule.ExcludedEpisodeIds, want)
	}

	for _, excluded := range f.episodes[2:] {
		_, err := f.useTicket(excluded.ID)
		assertWaitFreeRefusal(t, err, connect.CodeFailedPrecondition, rpcerrors.ReasonWaitFreeEpisodeExcluded)
	}
	if state := f.ticketState(t); state.NextAvailableAt != "" {
		t.Fatalf("next_available_at after refusals = %q, want the ticket still ready", state.NextAvailableAt)
	}
	if _, err := f.useTicket(f.episodes[1].ID); err != nil {
		t.Fatalf("UseTicket on the newest episode the rule allows: %v", err)
	}
}

// Every other refusal leaves the ticket unspent.
func TestDBUseTicketRefusals(t *testing.T) {
	f := newWaitFreeFixture(t, 2)
	setSeriesWaitFree(t, f.env, f.tenant.ID, f.series.ID, true, 23, 72, 0)
	free := f.env.PG.SeedEpisode(t, f.tenant.ID, f.series.ID, testutil.EpisodeSeed{PublicID: "EPISODEFREE1", Title: "Free", OrderIndex: 0, Status: testutil.EpisodeStatusPublished})
	f.env.PG.SeedPurchase(t, f.tenant.ID, f.reader.ID, f.episodes[1].ID, 300)
	unruled := f.env.PG.SeedSeries(t, f.tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00002", Title: "No Rule", Published: true})
	unruledEpisode := f.env.PG.SeedEpisode(t, f.tenant.ID, unruled.ID, testutil.EpisodeSeed{PublicID: "EPISODEB0001", Title: "No Rule", Status: testutil.EpisodeStatusPublished, Price: 300})
	disabled := f.env.PG.SeedSeries(t, f.tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00003", Title: "Rule Off", Published: true})
	disabledEpisode := f.env.PG.SeedEpisode(t, f.tenant.ID, disabled.ID, testutil.EpisodeSeed{PublicID: "EPISODEC0001", Title: "Rule Off", Status: testutil.EpisodeStatusPublished, Price: 300})
	setSeriesWaitFree(t, f.env, f.tenant.ID, disabled.ID, false, 23, 72, 0)
	other := f.env.seedTenant(t, "TENANTB", "tenant-b.example.com", "Tenant B")
	otherSeries := f.env.PG.SeedSeries(t, other.ID, testutil.SeriesSeed{PublicID: "SERIESB00001", Title: "Elsewhere", Published: true})
	otherEpisode := f.env.PG.SeedEpisode(t, other.ID, otherSeries.ID, testutil.EpisodeSeed{PublicID: "EPISODED0001", Title: "Elsewhere", Status: testutil.EpisodeStatusPublished, Price: 300})
	setSeriesWaitFree(t, f.env, other.ID, otherSeries.ID, true, 23, 72, 0)

	for _, tt := range []struct {
		name      string
		episodeID uuid.UUID
		code      connect.Code
		reason    string
	}{
		{name: "a bought episode", episodeID: f.episodes[1].ID, code: connect.CodeAlreadyExists},
		{name: "a free episode", episodeID: free.ID, code: connect.CodeFailedPrecondition, reason: rpcerrors.ReasonWaitFreeEpisodeFree},
		{name: "a series with no rule", episodeID: unruledEpisode.ID, code: connect.CodeFailedPrecondition, reason: rpcerrors.ReasonWaitFreeNotOffered},
		{name: "a series whose rule is off", episodeID: disabledEpisode.ID, code: connect.CodeFailedPrecondition, reason: rpcerrors.ReasonWaitFreeNotOffered},
		{name: "another tenant's episode", episodeID: otherEpisode.ID, code: connect.CodeNotFound},
	} {
		t.Run(tt.name, func(t *testing.T) {
			_, err := f.useTicket(tt.episodeID)
			assertWaitFreeRefusal(t, err, tt.code, tt.reason)
		})
	}

	t.Run("a guest", func(t *testing.T) {
		_, err := f.env.waitFreeClient().UseTicket(context.Background(),
			&publirav1.UseTicketRequest{Tenant: tenantContext(f.tenant), EpisodeId: f.episodes[0].ID.String()},
		)
		assertWaitFreeRefusal(t, err, connect.CodeUnauthenticated, "")
	})

	if state := f.ticketState(t); state.NextAvailableAt != "" {
		t.Fatalf("next_available_at after refusals = %q, want the ticket still ready", state.NextAvailableAt)
	}
	if _, err := f.useTicket(f.episodes[0].ID); err != nil {
		t.Fatalf("UseTicket after the refusals: %v", err)
	}
}

// A reader the tenant's age rule stops would spend a ticket on an episode the
// rule keeps closed, so the ticket is refused instead.
func TestDBUseTicketRefusesAReaderTheAgeRuleStops(t *testing.T) {
	f := newWaitFreeFixture(t, 0)
	setTenantAgeVerification(t, f.env, f.tenant.ID, ageverification.R18)
	rated := f.env.PG.SeedSeries(t, f.tenant.ID, testutil.SeriesSeed{PublicID: "SERIESR18001", Title: "Rated", Published: true, AgeRating: ageverification.RatingR18})
	episode := f.env.PG.SeedEpisode(t, f.tenant.ID, rated.ID, testutil.EpisodeSeed{PublicID: "EPISODER1801", Title: "Rated", Status: testutil.EpisodeStatusPublished, Price: 300})
	setSeriesWaitFree(t, f.env, f.tenant.ID, rated.ID, true, 23, 72, 0)

	_, err := f.useTicket(episode.ID)
	assertWaitFreeRefusal(t, err, connect.CodePermissionDenied, "")
	if got := countWaitFreeTickets(t, f.env, f.reader.ID, episode.ID); got != 0 {
		t.Fatalf("wait-free tickets = %d, want none", got)
	}
}

// An expired ticket is still not revoked, and the same episode can be opened
// with a later ticket all the same; a staff ticket on it is no obstacle either.
func TestDBUseTicketReopensAnEpisodeWhoseTicketExpired(t *testing.T) {
	f := newWaitFreeFixture(t, 1)
	setSeriesWaitFree(t, f.env, f.tenant.ID, f.series.ID, true, 23, 72, 0)
	expired := time.Now().Add(-time.Hour)
	seedAccessTicket(t, f.env, f.tenant.ID, "TICKETSTAFF1", f.episodes[0].ID, f.reader.ID, &expired, nil)

	if _, err := f.useTicket(f.episodes[0].ID); err != nil {
		t.Fatalf("UseTicket over an expired staff ticket: %v", err)
	}
	execSQL(t, f.env, `
		UPDATE access_tickets SET expires_at = NOW() - INTERVAL '1 second'
		WHERE user_id = $1 AND episode_id = $2 AND source = 'wait_free'
	`, f.reader.ID, f.episodes[0].ID)
	if got := f.episodeAccess(t, f.episodes[0]).Access; got != publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED {
		t.Fatalf("access after the ticket expired = %v, want locked", got)
	}
	if state := f.ticketState(t); len(state.OpenTickets) != 0 {
		t.Fatalf("open tickets after expiry = %v, want none", state.OpenTickets)
	}

	rechargeWaitFree(t, f.env, f.reader.ID, f.series.ID)
	if _, err := f.useTicket(f.episodes[0].ID); err != nil {
		t.Fatalf("UseTicket on the same episode again: %v", err)
	}
	if got := countWaitFreeTickets(t, f.env, f.reader.ID, f.episodes[0].ID); got != 2 {
		t.Fatalf("wait-free tickets = %d, want 2", got)
	}
	if got := f.episodeAccess(t, f.episodes[0]).Access; got != publirav1.EpisodeAccess_EPISODE_ACCESS_ENTITLED {
		t.Fatalf("access after the second ticket = %v, want entitled", got)
	}
}

// The series read says nothing about wait-for-free until the rule is on, and
// the ticket state of a series without it is refused.
func TestDBWaitFreeRuleIsSilentWhileOff(t *testing.T) {
	f := newWaitFreeFixture(t, 1)
	seriesDetail := func(t *testing.T) *publirav1.GetSeriesDetailResponse {
		t.Helper()
		resp, err := f.env.catalogClient().GetSeriesDetail(context.Background(),
			&publirav1.GetSeriesDetailRequest{Tenant: tenantContext(f.tenant), PublicId: f.series.PublicID},
		)
		if err != nil {
			t.Fatalf("GetSeriesDetail: %v", err)
		}
		return resp
	}
	stateErr := func() error {
		_, err := f.env.waitFreeClient().GetMyTicketState(testutil.WithBearer(context.Background(), f.token), &publirav1.GetMyTicketStateRequest{Tenant: tenantContext(f.tenant), SeriesId: f.series.ID.String()})
		return err
	}

	if got := seriesDetail(t).WaitFree; got != nil {
		t.Fatalf("wait_free with no rule = %+v, want unset", got)
	}
	assertWaitFreeRefusal(t, stateErr(), connect.CodeFailedPrecondition, rpcerrors.ReasonWaitFreeNotOffered)

	setSeriesWaitFree(t, f.env, f.tenant.ID, f.series.ID, false, 23, 72, 0)
	if got := seriesDetail(t).WaitFree; got != nil {
		t.Fatalf("wait_free with the rule off = %+v, want unset", got)
	}
	assertWaitFreeRefusal(t, stateErr(), connect.CodeFailedPrecondition, rpcerrors.ReasonWaitFreeNotOffered)

	setSeriesWaitFree(t, f.env, f.tenant.ID, f.series.ID, true, 23, 72, 0)
	if got := seriesDetail(t).WaitFree; got == nil || len(got.ExcludedEpisodeIds) != 0 {
		t.Fatalf("wait_free with the rule on = %+v, want a rule keeping nothing back", got)
	}
	if err := stateErr(); err != nil {
		t.Fatalf("GetMyTicketState with the rule on: %v", err)
	}
}

// Every request charges the reader's allowance before anything is read, so a
// reader cycling through episodes the rule refuses runs out like any other.
func TestDBUseTicketChargesTheSharedFloodControl(t *testing.T) {
	env := newPublicDBEnvWithGuards(t, guardsWith(func(policy *platformpolicy.Policy) {
		policy.WaitFreeTicketUse = platformpolicy.MinuteDay{PerMinute: 2, PerDay: 2}
	}))
	f := newWaitFreeFixtureOn(t, env, 2)
	setSeriesWaitFree(t, f.env, f.tenant.ID, f.series.ID, true, 23, 72, 1)

	for range 2 {
		_, err := f.useTicket(f.episodes[1].ID)
		assertWaitFreeRefusal(t, err, connect.CodeFailedPrecondition, rpcerrors.ReasonWaitFreeEpisodeExcluded)
	}
	_, err := f.useTicket(f.episodes[0].ID)
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("a request past the allowance: code = %v, want resource_exhausted (err=%v)", connect.CodeOf(err), err)
	}
	if got := countWaitFreeTickets(t, f.env, f.reader.ID, f.episodes[0].ID); got != 0 {
		t.Fatalf("wait-free tickets = %d, want none", got)
	}
}

// The open tickets are the ones the reader can open where they are asking: an
// episode taken down since, or one the calling surface does not show, is not
// listed even while its ticket runs.
func TestDBGetMyTicketStateListsOnlyEpisodesTheSurfaceShows(t *testing.T) {
	f := newWaitFreeFixture(t, 3)
	setSeriesWaitFree(t, f.env, f.tenant.ID, f.series.ID, true, 23, 72, 0)
	for _, episode := range f.episodes {
		if _, err := f.useTicket(episode.ID); err != nil {
			t.Fatalf("UseTicket on %s: %v", episode.PublicID, err)
		}
		rechargeWaitFree(t, f.env, f.reader.ID, f.series.ID)
	}

	execSQL(t, f.env, "UPDATE episode_listings SET status = 'draft' WHERE episode_id = $1", f.episodes[1].ID)
	execSQL(t, f.env, "UPDATE episodes SET availability = 'app' WHERE id = $1", f.episodes[2].ID)

	state := f.ticketState(t)
	if len(state.OpenTickets) != 1 || state.OpenTickets[0].EpisodeId != f.episodes[0].ID.String() {
		t.Fatalf("open tickets on the web = %v, want only %s", state.OpenTickets, f.episodes[0].ID)
	}

	resp, err := f.env.waitFreeClient().GetMyTicketState(testutil.WithBearer(context.Background(), f.token), &publirav1.GetMyTicketStateRequest{
		Tenant:   tenantContext(f.tenant),
		SeriesId: f.series.ID.String(),
		Surface:  publirattypesv1.ClientSurface_CLIENT_SURFACE_APP,
	})
	if err != nil {
		t.Fatalf("GetMyTicketState in the app: %v", err)
	}
	var got []string
	for _, ticket := range resp.OpenTickets {
		got = append(got, ticket.EpisodeId)
	}
	slices.Sort(got)
	want := []string{f.episodes[0].ID.String(), f.episodes[2].ID.String()}
	slices.Sort(want)
	if !slices.Equal(got, want) {
		t.Fatalf("open tickets in the app = %v, want %v", got, want)
	}
}
