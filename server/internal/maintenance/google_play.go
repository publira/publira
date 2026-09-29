package maintenance

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/googleplay"
	"github.com/publira/publira/server/internal/paymentsettings"
	"github.com/publira/publira/server/internal/storepurchase"
)

// VoidedPurchaseLister is the part of the Google Play Developer API the sync
// calls.
type VoidedPurchaseLister interface {
	ListVoidedPurchases(ctx context.Context, serviceAccountKey []byte, packageName string, since, until time.Time) ([]googleplay.VoidedPurchase, error)
}

// voidedPurchaseWindowMargin keeps the start of the window inside the thirty
// days the API reads, which it measures at the moment it answers rather than
// at the moment this pass asked.
const voidedPurchaseWindowMargin = time.Hour

// GooglePlayVoidedPurchaseSync takes back the purchases Google Play refunded,
// for every tenant selling on Google Play. Each pass reads the whole window
// the Voided Purchases API keeps and writes what it finds idempotently, so
// the refunds voided while the worker was down are taken on the first pass
// after it returns, and it needs no record of how far it got. It has no
// tunables, and therefore no Load function.
type GooglePlayVoidedPurchaseSync struct{}

// Run reads every tenant's voided purchases.
func (s GooglePlayVoidedPurchaseSync) Run(ctx context.Context, deps Deps) error {
	return s.run(ctx, deps, time.Now())
}

func (s GooglePlayVoidedPurchaseSync) run(ctx context.Context, deps Deps, now time.Time) error {
	if deps.DB == nil {
		return errNoDB
	}
	if deps.GooglePlay == nil {
		return errNoGooglePlay
	}
	logger := deps.logger()
	started := time.Now()

	// Under row-level security the tenants would read as none, and the pass
	// would succeed having taken nothing back.
	if err := requireBypassRLS(ctx, deps.DB); err != nil {
		return err
	}
	queries := dbmodels.New(deps.DB)
	tenants, err := queries.ListTenantsSellingOnGooglePlay(ctx)
	if err != nil {
		return fmt.Errorf("list tenants selling on google play: %w", err)
	}

	var (
		failures               []error
		voidedCount, heldCount int
	)
	for _, tenantID := range tenants {
		voided, held, err := syncVoidedPurchases(ctx, deps, queries, tenantID, now)
		voidedCount += voided
		heldCount += held
		if err != nil {
			failures = append(failures, fmt.Errorf("tenant %s: %w", tenantID, err))
			logger.ErrorContext(ctx, "google play voided purchase sync failed", "tenant_id", tenantID, "error", err)
			// A cancelled context fails every remaining tenant the same way.
			if ctx.Err() != nil {
				break
			}
		}
	}

	attrs := []any{
		"tenant_count", len(tenants),
		"voided_count", voidedCount,
		"held_count", heldCount,
		"duration", time.Since(started),
	}
	if err := errors.Join(failures...); err != nil {
		logger.ErrorContext(ctx, "google play voided purchase sync pass failed", append(attrs, "error", err)...)
		return err
	}
	logger.InfoContext(ctx, "google play voided purchase sync pass completed", attrs...)
	return nil
}

// syncVoidedPurchases records every refund Google Play reports for one tenant
// and answers how many it read and how many had no purchase yet.
func syncVoidedPurchases(ctx context.Context, deps Deps, queries *dbmodels.Queries, tenantID uuid.UUID, now time.Time) (int, int, error) {
	credentials, err := paymentsettings.NewAppStores(queries, deps.Secrets).LoadGooglePlayCredentials(ctx, tenantID)
	if err != nil {
		return 0, 0, fmt.Errorf("load google play credentials: %w", err)
	}
	since := now.Add(-googleplay.MaxVoidedPurchaseAge + voidedPurchaseWindowMargin)
	voided, err := deps.GooglePlay.ListVoidedPurchases(ctx, []byte(credentials.ServiceAccountKey), credentials.PackageName, since, now)
	if err != nil {
		return 0, 0, fmt.Errorf("list voided purchases: %w", err)
	}
	held := 0
	for _, purchase := range voided {
		if purchase.PurchaseToken == "" {
			continue
		}
		applied, err := recordVoidedPurchase(ctx, deps, tenantID, purchase.PurchaseToken)
		if err != nil {
			return len(voided), held, err
		}
		if !applied {
			held++
		}
	}
	return len(voided), held, nil
}

// recordVoidedPurchase records one refund in a transaction of its own, which
// is what the lock serializing it with the purchase's confirmation lasts for.
func recordVoidedPurchase(ctx context.Context, deps Deps, tenantID uuid.UUID, token string) (bool, error) {
	tx, err := deps.DB.BeginTx(ctx, nil)
	if err != nil {
		return false, fmt.Errorf("begin refund transaction: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck
	applied, err := storepurchase.RecordRefund(ctx, dbmodels.New(tx), tenantID, storepurchase.StoreGooglePlay, token)
	if err != nil {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, fmt.Errorf("commit refund: %w", err)
	}
	return applied, nil
}
