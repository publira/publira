package adminapi

import (
	"context"
	"database/sql"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"google.golang.org/protobuf/proto"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/testutil"
)

func campaignPriceIDs(campaigns []*publiraadminv1.AdminEpisodeCampaignPrice) []string {
	ids := make([]string, 0, len(campaigns))
	for _, campaign := range campaigns {
		ids = append(ids, campaign.Id)
	}
	return ids
}

// campaignStartRevalidated reads whether the campaign's start has been written off as
// applied, which a campaign open the moment it is written is, so that
// apply-campaign-prices does not drop the caches for it a second time.
func (e *adminDBEnv) campaignStartRevalidated(t *testing.T, campaignID string) bool {
	t.Helper()
	var applied sql.NullTime
	if err := e.PG.DB.QueryRowContext(context.Background(),
		"SELECT start_revalidated_at FROM episode_campaign_prices WHERE id = $1", campaignID,
	).Scan(&applied); err != nil {
		t.Fatalf("read campaign price %s: %v", campaignID, err)
	}
	return applied.Valid
}

func TestDBCreateEpisodeCampaignPrice(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()
	seriesPublicID := createDBSeries(t, client, tenant, "Campaign Series")
	episodePublicID := createDBEpisode(t, client, tenant, seriesPublicID, "Chapter One")
	episodeID := env.episodeID(t, episodePublicID)

	base := time.Now().UTC().Add(time.Hour).Truncate(time.Second)
	create := func(price int32, startsAt, endsAt time.Time) (*publiraadminv1.AdminEpisodeCampaignPrice, error) {
		resp, err := client.CreateEpisodeCampaignPrice(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateEpisodeCampaignPriceRequest{
			Tenant:    tenant.tenantContext(),
			EpisodeId: episodeID,
			Price:     price,
			StartsAt:  rfc3339(startsAt),
			EndsAt:    rfc3339(endsAt),
		})
		if err != nil {
			return nil, err
		}
		return resp.CampaignPrice, nil
	}

	campaign, err := create(300, base, base.Add(2*time.Hour))
	if err != nil {
		t.Fatalf("CreateEpisodeCampaignPrice: %v", err)
	}
	if campaign.PublicId == "" || campaign.Id == "" {
		t.Fatal("created campaign carries no id, so nothing can address it again")
	}
	if campaign.EpisodeId != episodeID || campaign.EpisodePublicId != episodePublicID || campaign.SeriesPublicId != seriesPublicID || campaign.EpisodeTitle != "Chapter One" {
		t.Errorf("campaign names episode %q (%q, %q) of series %q, want %q of %q", campaign.EpisodeId, campaign.EpisodePublicId, campaign.EpisodeTitle, campaign.SeriesPublicId, episodeID, seriesPublicID)
	}
	if campaign.Price != 300 || campaign.StartsAt != rfc3339(base) || campaign.EndsAt != rfc3339(base.Add(2*time.Hour)) {
		t.Errorf("campaign = %d over %q..%q, want 300 over %q..%q", campaign.Price, campaign.StartsAt, campaign.EndsAt, rfc3339(base), rfc3339(base.Add(2*time.Hour)))
	}
	// A campaign ahead of its start changes nothing a cache holds yet, so its
	// start is left for apply-campaign-prices.
	if env.campaignStartRevalidated(t, campaign.Id) {
		t.Error("a campaign ahead of its start was written off as applied")
	}

	// At most one campaign covers an instant of an episode.
	if _, err := create(250, base.Add(time.Hour), base.Add(3*time.Hour)); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("overlapping campaign code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}
	// One campaign may follow another without a gap.
	if _, err := create(250, base.Add(2*time.Hour), base.Add(4*time.Hour)); err != nil {
		t.Fatalf("CreateEpisodeCampaignPrice starting where the first ends: %v", err)
	}

	// A campaign open the moment it is written is dropped from the caches by
	// the call itself.
	open, err := create(400, base.Add(-2*time.Hour), base.Add(-30*time.Minute))
	if err != nil {
		t.Fatalf("CreateEpisodeCampaignPrice open now: %v", err)
	}
	if !env.campaignStartRevalidated(t, open.Id) {
		t.Error("a campaign open when written was left for apply-campaign-prices to drop again")
	}
}

func TestDBCreateEpisodeCampaignPriceRejectsWhatCannotCutThePrice(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()
	seriesPublicID := createDBSeries(t, client, tenant, "Campaign Series")
	priced := env.episodeID(t, createDBEpisode(t, client, tenant, seriesPublicID, "Chapter One"))
	free, err := client.CreateEpisode(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateEpisodeRequest{
		Tenant:   tenant.tenantContext(),
		SeriesId: env.seriesID(t, seriesPublicID),
		Title:    "Free Chapter",
	})
	if err != nil {
		t.Fatalf("CreateEpisode free: %v", err)
	}

	now := time.Now().UTC()
	cases := []struct {
		name      string
		episodeID string
		price     int32
		currency  string
		startsAt  string
		endsAt    string
		wantCode  connect.Code
	}{
		{"no price", priced, 0, "", rfc3339(now.Add(time.Hour)), rfc3339(now.Add(2 * time.Hour)), connect.CodeInvalidArgument},
		{"the episode's own price", priced, 500, "", rfc3339(now.Add(time.Hour)), rfc3339(now.Add(2 * time.Hour)), connect.CodeInvalidArgument},
		{"above the episode's price", priced, 600, "", rfc3339(now.Add(time.Hour)), rfc3339(now.Add(2 * time.Hour)), connect.CodeInvalidArgument},
		{"a free episode", free.Episode.Id, 100, "", rfc3339(now.Add(time.Hour)), rfc3339(now.Add(2 * time.Hour)), connect.CodeInvalidArgument},
		{"already over", priced, 300, "", rfc3339(now.Add(-2 * time.Hour)), rfc3339(now.Add(-time.Hour)), connect.CodeInvalidArgument},
		{"ends before it starts", priced, 300, "", rfc3339(now.Add(2 * time.Hour)), rfc3339(now.Add(time.Hour)), connect.CodeInvalidArgument},
		{"entered in another currency", priced, 300, "EUR", rfc3339(now.Add(time.Hour)), rfc3339(now.Add(2 * time.Hour)), connect.CodeFailedPrecondition},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := client.CreateEpisodeCampaignPrice(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateEpisodeCampaignPriceRequest{
				Tenant:    tenant.tenantContext(),
				EpisodeId: tc.episodeID,
				Price:     tc.price,
				Currency:  tc.currency,
				StartsAt:  tc.startsAt,
				EndsAt:    tc.endsAt,
			})
			if connect.CodeOf(err) != tc.wantCode {
				t.Fatalf("code = %v, want %v (err=%v)", connect.CodeOf(err), tc.wantCode, err)
			}
		})
	}
}

// The same price and period go on every episode named, or on none: a price one
// of them does not undercut, or a period one of them already has a campaign
// in, leaves every episode as it was.
func TestDBCreateSeriesCampaignPricesIsAllOrNothing(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()
	seriesPublicID := createDBSeries(t, client, tenant, "Campaign Series")
	seriesID := env.seriesID(t, seriesPublicID)
	first := env.episodeID(t, createDBEpisode(t, client, tenant, seriesPublicID, "Chapter One"))
	second := env.episodeID(t, createDBEpisode(t, client, tenant, seriesPublicID, "Chapter Two"))
	cheap, err := client.CreateEpisode(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateEpisodeRequest{
		Tenant:   tenant.tenantContext(),
		SeriesId: seriesID,
		Title:    "Cheap Chapter",
		Price:    200,
	})
	if err != nil {
		t.Fatalf("CreateEpisode cheap: %v", err)
	}

	base := time.Now().UTC().Add(time.Hour).Truncate(time.Second)
	create := func(episodeIDs []string, startsAt time.Time) (*publiraadminv1.CreateSeriesCampaignPricesResponse, error) {
		return client.CreateSeriesCampaignPrices(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateSeriesCampaignPricesRequest{
			Tenant:     tenant.tenantContext(),
			SeriesId:   seriesID,
			EpisodeIds: episodeIDs,
			Price:      300,
			StartsAt:   rfc3339(startsAt),
			EndsAt:     rfc3339(startsAt.Add(24 * time.Hour)),
		})
	}
	listed := func() []string {
		t.Helper()
		resp, err := client.ListEpisodeCampaignPrices(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.ListEpisodeCampaignPricesRequest{
			Tenant: tenant.tenantContext(),
			Scope:  &publiraadminv1.ListEpisodeCampaignPricesRequest_SeriesId{SeriesId: seriesID},
		})
		if err != nil {
			t.Fatalf("ListEpisodeCampaignPrices: %v", err)
		}
		return campaignPriceIDs(resp.CampaignPrices)
	}

	if _, err := create(nil, base); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("naming no episode code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	if _, err := create([]string{first, cheap.Episode.Id}, base); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("a price one episode does not undercut code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	if got := listed(); len(got) != 0 {
		t.Fatalf("campaigns after a refused call = %v, want none", got)
	}

	created, err := create([]string{second, first}, base)
	if err != nil {
		t.Fatalf("CreateSeriesCampaignPrices: %v", err)
	}
	if len(created.CampaignPrices) != 2 || created.CampaignPrices[0].EpisodeId != first || created.CampaignPrices[1].EpisodeId != second {
		t.Fatalf("campaigns = %v, want one each on %s and %s in the series' order", created.CampaignPrices, first, second)
	}
	for _, campaign := range created.CampaignPrices {
		if campaign.Price != 300 || campaign.SeriesId != seriesID {
			t.Fatalf("campaign = %v, want 300 in series %s", campaign, seriesID)
		}
	}

	// The first episode already has a campaign over this period, so the
	// second gets none either.
	if _, err := client.CreateEpisodeCampaignPrice(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateEpisodeCampaignPriceRequest{
		Tenant:    tenant.tenantContext(),
		EpisodeId: second,
		Price:     250,
		StartsAt:  rfc3339(base.Add(48 * time.Hour)),
		EndsAt:    rfc3339(base.Add(72 * time.Hour)),
	}); err != nil {
		t.Fatalf("CreateEpisodeCampaignPrice: %v", err)
	}
	before := listed()
	if _, err := create([]string{first, second}, base.Add(36*time.Hour)); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("overlapping series campaign code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}
	if got := listed(); !slices.Equal(got, before) {
		t.Fatalf("campaigns after an overlap = %v, want them as they were: %v", got, before)
	}
}

// A campaign scheduled in one call is listed for a later one, and removed by
// the id the listing carries, inside the tenant that scheduled it alone.
func TestDBListAndDeleteEpisodeCampaignPrices(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	other := env.seedTenantWithAdmin(t, "TENANTB", "tenant-b.example.com", "Tenant B", "TBUSER01", "admin@tenant-b.example.com")
	client := env.seriesClient()
	seriesPublicID := createDBSeries(t, client, tenant, "Campaign Series")
	seriesID := env.seriesID(t, seriesPublicID)
	episodeID := env.episodeID(t, createDBEpisode(t, client, tenant, seriesPublicID, "Chapter One"))

	base := time.Now().UTC().Add(time.Hour).Truncate(time.Second)
	schedule := func(startsAt time.Time) *publiraadminv1.AdminEpisodeCampaignPrice {
		t.Helper()
		resp, err := client.CreateEpisodeCampaignPrice(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateEpisodeCampaignPriceRequest{
			Tenant:    tenant.tenantContext(),
			EpisodeId: episodeID,
			Price:     300,
			StartsAt:  rfc3339(startsAt),
			EndsAt:    rfc3339(startsAt.Add(time.Hour)),
		})
		if err != nil {
			t.Fatalf("CreateEpisodeCampaignPrice: %v", err)
		}
		return resp.CampaignPrice
	}
	sooner := schedule(base)
	later := schedule(base.Add(24 * time.Hour))

	for name, scoped := range map[string]func(*publiraadminv1.ListEpisodeCampaignPricesRequest) *publiraadminv1.ListEpisodeCampaignPricesRequest{
		"episode": func(req *publiraadminv1.ListEpisodeCampaignPricesRequest) *publiraadminv1.ListEpisodeCampaignPricesRequest {
			req.Scope = &publiraadminv1.ListEpisodeCampaignPricesRequest_EpisodeId{EpisodeId: episodeID}
			return req
		},
		"series": func(req *publiraadminv1.ListEpisodeCampaignPricesRequest) *publiraadminv1.ListEpisodeCampaignPricesRequest {
			req.Scope = &publiraadminv1.ListEpisodeCampaignPricesRequest_SeriesId{SeriesId: seriesID}
			return req
		},
	} {
		resp, err := client.ListEpisodeCampaignPrices(testutil.WithBearer(context.Background(), tenant.token()), scoped(&publiraadminv1.ListEpisodeCampaignPricesRequest{
			Tenant: tenant.tenantContext(),
		}))
		if err != nil {
			t.Fatalf("ListEpisodeCampaignPrices by %s: %v", name, err)
		}
		// Latest start first.
		if got, want := campaignPriceIDs(resp.CampaignPrices), []string{later.Id, sooner.Id}; !slices.Equal(got, want) {
			t.Fatalf("campaigns by %s = %v, want %v", name, got, want)
		}
		if !proto.Equal(resp.CampaignPrices[0], later) {
			t.Errorf("listed campaign = %v, want what CreateEpisodeCampaignPrice answered: %v", resp.CampaignPrices[0], later)
		}

		elsewhere, err := client.ListEpisodeCampaignPrices(testutil.WithBearer(context.Background(), other.token()), scoped(&publiraadminv1.ListEpisodeCampaignPricesRequest{
			Tenant: other.tenantContext(),
		}))
		if err != nil {
			t.Fatalf("ListEpisodeCampaignPrices by %s in another tenant: %v", name, err)
		}
		if len(elsewhere.CampaignPrices) != 0 {
			t.Fatalf("another tenant lists %v by %s, want nothing", elsewhere.CampaignPrices, name)
		}
	}

	paged, err := client.ListEpisodeCampaignPrices(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.ListEpisodeCampaignPricesRequest{
		Tenant: tenant.tenantContext(),
		Scope:  &publiraadminv1.ListEpisodeCampaignPricesRequest_EpisodeId{EpisodeId: episodeID},
		Limit:  1,
	})
	if err != nil {
		t.Fatalf("ListEpisodeCampaignPrices limit 1: %v", err)
	}
	if got := campaignPriceIDs(paged.CampaignPrices); !slices.Equal(got, []string{later.Id}) || paged.NextToken == "" {
		t.Fatalf("first page = %v (next %q), want %s and a token for the rest", got, paged.NextToken, later.Id)
	}
	rest, err := client.ListEpisodeCampaignPrices(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.ListEpisodeCampaignPricesRequest{
		Tenant: tenant.tenantContext(),
		Scope:  &publiraadminv1.ListEpisodeCampaignPricesRequest_EpisodeId{EpisodeId: episodeID},
		Limit:  1,
		Token:  paged.NextToken,
	})
	if err != nil {
		t.Fatalf("ListEpisodeCampaignPrices next page: %v", err)
	}
	if got := campaignPriceIDs(rest.CampaignPrices); !slices.Equal(got, []string{sooner.Id}) || rest.NextToken != "" {
		t.Fatalf("second page = %v (next %q), want %s and no further page", got, rest.NextToken, sooner.Id)
	}

	del := func(seat adminDBTenant, campaignID string) error {
		_, err := client.DeleteEpisodeCampaignPrice(testutil.WithBearer(context.Background(), seat.token()), &publiraadminv1.DeleteEpisodeCampaignPriceRequest{
			Tenant:          seat.tenantContext(),
			CampaignPriceId: campaignID,
		})
		return err
	}
	if err := del(other, sooner.Id); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("cross-tenant delete code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
	if err := del(tenant, sooner.Id); err != nil {
		t.Fatalf("DeleteEpisodeCampaignPrice: %v", err)
	}
	if err := del(tenant, sooner.Id); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("second delete code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
	// The period is free again once the campaign is gone.
	schedule(base)
}
