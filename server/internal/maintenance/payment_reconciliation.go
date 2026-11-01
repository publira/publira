package maintenance

import (
	"context"
	"time"

	"github.com/publira/publira/server/internal/paymentreconciliation"
)

// PaymentReconciliation runs the reconciliations Tenant admins started and
// the worker has not finished, each against the provider or the store it
// names, and records what each found. A pass with none waiting does nothing.
// A run its source fails is recorded as failed rather than retried, since a
// Tenant admin who fixes the credentials starts it again; the pass fails only
// when it cannot record the runs at all. It has no tunables, and therefore no
// Load function.
type PaymentReconciliation struct{}

// Run runs every reconciliation waiting.
func (PaymentReconciliation) Run(ctx context.Context, deps Deps) error {
	if deps.DB == nil {
		return errNoDB
	}
	logger := deps.logger()
	started := time.Now()
	summary, err := paymentreconciliation.RunPending(ctx, paymentreconciliation.Deps{
		DB:               deps.DB,
		Secrets:          deps.Secrets,
		Payments:         deps.Payments,
		AppStore:         deps.AppStore,
		AppStoreVerifier: deps.AppStoreVerifier,
		GooglePlay:       deps.GooglePlay,
		Logger:           logger,
	})
	attrs := []any{
		"succeeded_count", summary.Succeeded,
		"failed_count", summary.Failed,
		"duration", time.Since(started),
	}
	if err != nil {
		logger.ErrorContext(ctx, "payment reconciliation pass failed", append(attrs, "error", err)...)
		return err
	}
	if summary.Succeeded+summary.Failed > 0 {
		logger.InfoContext(ctx, "payment reconciliation pass completed", attrs...)
	}
	return nil
}
