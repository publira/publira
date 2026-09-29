package publicapi

import (
	"context"
	"errors"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/genproto/googleapis/rpc/errdetails"

	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/testutil"
)

// assertCreditedReaderRefusal fails unless err is the refusal a reader credited
// on the episode gets.
func assertCreditedReaderRefusal(t *testing.T, err error) {
	t.Helper()

	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("code = %v, want permission_denied (err=%v)", connect.CodeOf(err), err)
	}
	var connectErr *connect.Error
	if errors.As(err, &connectErr) {
		for _, detail := range connectErr.Details() {
			value, valueErr := detail.Value()
			if valueErr != nil {
				continue
			}
			if info, ok := value.(*errdetails.ErrorInfo); ok &&
				info.GetDomain() == rpcerrors.ErrorInfoDomain &&
				info.GetReason() == rpcerrors.ReasonReaderCreditedOnEpisode {
				return
			}
		}
	}
	t.Fatalf("missing %s ErrorInfo on %v", rpcerrors.ReasonReaderCreditedOnEpisode, err)
}

// A credited creator's stars would enter the figures the storefront ranks by,
// so they cannot rate their own episode, free or paid, even with a purchase.
// The credit that counts is the episode's own, as it is for the grant.
func TestDBRateEpisodeRefusesTheCreditedCreator(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Rated Series", Published: true})
	free := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEFRE01", Title: "Free", Status: testutil.EpisodeStatusPublished})
	paid := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEPAY01", Title: "Paid", Status: testutil.EpisodeStatusPublished, Price: 500})

	credited := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{Name: "Credited"})
	env.PG.SeedSeriesCreator(t, tenant.ID, series.ID, credited.ID, "")
	env.PG.SeedEpisodeCreator(t, tenant.ID, free.ID, credited.ID, "")
	env.PG.SeedEpisodeCreator(t, tenant.ID, paid.ID, credited.ID, "")
	seriesOnly := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{Name: "Series Only"})
	env.PG.SeedSeriesCreator(t, tenant.ID, series.ID, seriesOnly.ID, "")

	creatorAccount := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERCRE01", "creator@tenant-a.example.com", "Creator Account")
	env.PG.SeedCreatorAccount(t, tenant.ID, credited.ID, creatorAccount.ID)
	env.PG.SeedPurchase(t, tenant.ID, creatorAccount.ID, paid.ID, 500)
	seriesCreatorAccount := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERSER01", "series@tenant-a.example.com", "Series Creator Account")
	env.PG.SeedCreatorAccount(t, tenant.ID, seriesOnly.ID, seriesCreatorAccount.ID)
	reader := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERRDR01", "reader@tenant-a.example.com", "Reader")
	env.PG.SeedPurchase(t, tenant.ID, reader.ID, paid.ID, 500)

	client := env.ratingClient()
	for _, episode := range []testutil.Episode{free, paid} {
		_, err := client.RateEpisode(context.Background(), rateEpisodeRequest(tenant, episode.ID.String(), tokenFor(t, tenant, creatorAccount), 1))
		assertCreditedReaderRefusal(t, err)
	}
	if got := env.countRows(t, "SELECT COUNT(*) FROM episode_ratings WHERE tenant_id = $1 AND user_id = $2", tenant.ID, creatorAccount.ID); got != 0 {
		t.Fatalf("the creator's stored ratings = %d, want none", got)
	}

	rate := func(t *testing.T, user testutil.TenantUser, episode testutil.Episode) {
		t.Helper()
		if _, err := client.RateEpisode(context.Background(), rateEpisodeRequest(tenant, episode.ID.String(), tokenFor(t, tenant, user), 1)); err != nil {
			t.Fatalf("RateEpisode %s by %s: %v", episode.PublicID, user.PublicID, err)
		}
	}
	rate(t, seriesCreatorAccount, free)
	rate(t, reader, free)
	rate(t, reader, paid)
}

// The reaction control is built from GetMyEpisodeRating, so the credit that
// refuses a rating is reported there, on a free episode as on a paid one. A
// creator credited on the series alone, and a reader holding a purchase, read
// it as not credited.
func TestDBGetMyEpisodeRatingReportsTheCreditedCreator(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Rated Series", Published: true})
	free := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEFRE01", Title: "Free", Status: testutil.EpisodeStatusPublished})
	paid := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEPAY01", Title: "Paid", Status: testutil.EpisodeStatusPublished, Price: 500})

	credited := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{Name: "Credited"})
	env.PG.SeedEpisodeCreator(t, tenant.ID, free.ID, credited.ID, "")
	env.PG.SeedEpisodeCreator(t, tenant.ID, paid.ID, credited.ID, "")
	seriesOnly := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{Name: "Series Only"})
	env.PG.SeedSeriesCreator(t, tenant.ID, series.ID, seriesOnly.ID, "")

	creatorAccount := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERCRE01", "creator@tenant-a.example.com", "Creator Account")
	env.PG.SeedCreatorAccount(t, tenant.ID, credited.ID, creatorAccount.ID)
	seriesCreatorAccount := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERSER01", "series@tenant-a.example.com", "Series Creator Account")
	env.PG.SeedCreatorAccount(t, tenant.ID, seriesOnly.ID, seriesCreatorAccount.ID)
	reader := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERRDR01", "reader@tenant-a.example.com", "Reader")
	env.PG.SeedPurchase(t, tenant.ID, reader.ID, paid.ID, 500)

	client := env.ratingClient()
	for _, tc := range []struct {
		user testutil.TenantUser
		want bool
	}{
		{user: creatorAccount, want: true},
		{user: seriesCreatorAccount, want: false},
		{user: reader, want: false},
	} {
		for _, episode := range []testutil.Episode{free, paid} {
			res, err := client.GetMyEpisodeRating(context.Background(), myEpisodeRatingRequest(tenant, episode.ID.String(), tokenFor(t, tenant, tc.user)))
			if err != nil {
				t.Fatalf("GetMyEpisodeRating %s by %s: %v", episode.PublicID, tc.user.PublicID, err)
			}
			if res.Msg.ReaderCredited != tc.want {
				t.Fatalf("GetMyEpisodeRating %s by %s reader_credited = %v, want %v", episode.PublicID, tc.user.PublicID, res.Msg.ReaderCredited, tc.want)
			}
		}
	}
}

// Answering readers under one's own episode is what the creator's account is
// for, so the credit that refuses a rating leaves commenting open.
func TestDBPostEpisodeCommentStaysOpenToTheCreditedCreator(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	env.setCommentMode(t, tenant.ID, "immediate")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Commented Series", Published: true})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEPAY01", Title: "Paid", Status: testutil.EpisodeStatusPublished, Price: 500})
	credited := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{Name: "Credited"})
	env.PG.SeedEpisodeCreator(t, tenant.ID, episode.ID, credited.ID, "")
	creatorAccount := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERCRE01", "creator@tenant-a.example.com", "Creator Account")
	env.PG.SeedCreatorAccount(t, tenant.ID, credited.ID, creatorAccount.ID)

	env.mustPostComment(t, tenant, creatorAccount, episode.ID.String(), "Thank you for reading.")
}

// A checkout would charge the creator for an episode their credit already
// opens, so it is refused before the provider is asked. Another episode, and
// another reader of the same one, check out as before.
func TestDBStartEpisodeCheckoutRefusesTheCreditedCreator(t *testing.T) {
	env := newPurchaseSurfaceEnv(t)
	series := env.pg.SeedSeries(t, env.tenant.ID, testutil.SeriesSeed{PublicID: "PAYCREDSR001", Title: "Credited Series", Published: true})
	own := env.pg.SeedEpisode(t, env.tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "PAYCREDEP001", Status: testutil.EpisodeStatusPublished, Price: 500})
	other := env.pg.SeedEpisode(t, env.tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "PAYCREDEP002", Status: testutil.EpisodeStatusPublished, Price: 500})
	credited := env.pg.SeedCreator(t, env.tenant.ID, testutil.CreatorSeed{Name: "Credited"})
	env.pg.SeedSeriesCreator(t, env.tenant.ID, series.ID, credited.ID, "")
	env.pg.SeedEpisodeCreator(t, env.tenant.ID, own.ID, credited.ID, "")
	env.pg.SeedCreatorAccount(t, env.tenant.ID, credited.ID, env.user.ID)
	reader := env.pg.SeedEndUser(t, env.tenant.ID, "PAYCREDRDR01", "reader@example.com", "Reader")

	client := publirav1connect.NewPurchaseServiceClient(env.ts.Client(), env.ts.URL)
	for _, from := range []publirav1.StartEpisodeCheckoutRequest_Client{checkoutFromWeb, checkoutFromApp} {
		_, err := client.StartEpisodeCheckout(context.Background(), newBearerRequest(&publirav1.StartEpisodeCheckoutRequest{
			EpisodeId: own.ID.String(),
			Tenant:    tenantContext(env.tenant),
			Client:    from,
		}, env.token))
		assertCreditedReaderRefusal(t, err)
		if env.checkout.input.SuccessURL != "" {
			t.Fatalf("a checkout from %v was started with the provider", from)
		}
	}

	if code, started := env.startCheckout(t, other.ID.String(), checkoutFromWeb); code != checkoutSucceeded || !started {
		t.Fatalf("checkout of an episode the creator is not credited on = %v (started %v), want it started", code, started)
	}
	if _, err := client.StartEpisodeCheckout(context.Background(), newBearerRequest(&publirav1.StartEpisodeCheckoutRequest{
		EpisodeId: own.ID.String(),
		Tenant:    tenantContext(env.tenant),
		Client:    checkoutFromWeb,
	}, tokenFor(t, env.tenant, reader))); err != nil {
		t.Fatalf("another reader's checkout: %v", err)
	}
}

// The app's own purchase is refused the same way, before any intent is opened.
func TestDBStartStorePurchaseRefusesTheCreditedCreator(t *testing.T) {
	env := newStorePurchaseEnv(t)
	credited := env.pg.SeedCreator(t, env.tenant.ID, testutil.CreatorSeed{Name: "Credited"})
	env.pg.SeedEpisodeCreator(t, env.tenant.ID, env.episode.ID, credited.ID, "")
	creatorAccount := env.pg.SeedEndUser(t, env.tenant.ID, "STORECREATR1", "creator@example.com", "Creator Account")
	env.pg.SeedCreatorAccount(t, env.tenant.ID, credited.ID, creatorAccount.ID)

	_, err := env.client.StartStorePurchase(context.Background(), newBearerRequest(&publirav1.StartStorePurchaseRequest{
		Tenant:    tenantContext(env.tenant),
		EpisodeId: env.episode.ID.String(),
		Store:     publirav1.InAppPurchaseStore_IN_APP_PURCHASE_STORE_APP_STORE,
	}, tokenFor(t, env.tenant, creatorAccount)))
	assertCreditedReaderRefusal(t, err)
	if got := env.count(t, "SELECT count(*) FROM store_purchase_intents WHERE tenant_id = $1", env.tenant.ID); got != 0 {
		t.Fatalf("store_purchase_intents rows = %d, want none", got)
	}

	env.start(t, env.token)
}
