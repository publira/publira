package publicapi

import (
	"context"
	"database/sql"
	"log/slog"
	"testing"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/platformpolicy"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/revalidate"
	"github.com/publira/publira/server/internal/testutil"
)

// An episode, a volume, and a coin pack checkout write nothing, so the
// allowance they share is all that keeps a reader from making the storefront
// ask the tenant's provider for checkouts without end. The limit is the one
// saved as the platform's policy, through the save publiractl policy set
// makes, and read the way a running server reads it.
func TestDBPurchaseCheckoutStartsShareTheReadersAllowance(t *testing.T) {
	t.Parallel()

	f := newCoinPackFixtureGuardedBy(t, func(db *sql.DB) readerGuards {
		return readerGuards{limiter: testutil.Limiter(), policy: platformpolicy.NewResolver(dbmodels.New(db), 0, slog.Default())}
	})
	volume := f.env.PG.SeedVolume(t, f.tenant.ID, f.series.ID, testutil.VolumeSeed{
		Title:      "Volume",
		Price:      250,
		Published:  true,
		EpisodeIDs: []uuid.UUID{f.episode.ID},
	})
	savePolicy := func(limit platformpolicy.MinuteDay) {
		t.Helper()
		policy := openPolicy()
		policy.TenantCoinsAllowed = true
		policy.PurchaseCheckout = limit
		if _, err := platformpolicy.Save(context.Background(), f.env.PG.DB, slog.Default(), auditlog.SystemPlatformActor, platformpolicy.SaveParams{Policy: policy}, revalidate.RecordCatalogDrop); err != nil {
			t.Fatalf("save the platform policy: %v", err)
		}
	}
	starts := map[string]func() error{
		"StartEpisodeCheckout": func() error {
			_, err := f.purchases.StartEpisodeCheckout(f.readerCtx(t), &publirav1.StartEpisodeCheckoutRequest{
				Tenant:    tenantContext(f.tenant),
				EpisodeId: f.episode.ID.String(),
			})
			return err
		},
		"StartVolumeCheckout": func() error {
			_, err := f.purchases.StartVolumeCheckout(f.readerCtx(t), &publirav1.StartVolumeCheckoutRequest{
				Tenant:   tenantContext(f.tenant),
				VolumeId: volume.ID.String(),
			})
			return err
		},
		"StartCoinPackCheckout": func() error { return f.startCheckout(t, f.pack.ID, "") },
	}

	savePolicy(platformpolicy.MinuteDay{PerMinute: 3, PerDay: 3})
	for name, start := range starts {
		if err := start(); err != nil {
			t.Fatalf("%s within the limit: %v", name, err)
		}
	}
	for name, start := range starts {
		if err := start(); connect.CodeOf(err) != connect.CodeResourceExhausted {
			t.Fatalf("%s past the limit = %v, want resource_exhausted", name, err)
		}
	}
	if got := len(f.checkout.sent); got != 3 {
		t.Fatalf("checkouts asked of the provider = %d, want the 3 within the limit alone", got)
	}

	// The refused starts were counted as well, so the raised limit clears
	// them too.
	savePolicy(platformpolicy.MinuteDay{PerMinute: 10, PerDay: 10})
	if err := starts["StartEpisodeCheckout"](); err != nil {
		t.Fatalf("StartEpisodeCheckout after the limit was raised: %v", err)
	}
}
