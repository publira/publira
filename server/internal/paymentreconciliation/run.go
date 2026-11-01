package paymentreconciliation

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/dbroles"
	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentsettings"
	"github.com/publira/publira/server/internal/storeproduct"
	"github.com/publira/publira/server/internal/storepurchase"
)

// The reasons a run fails, as payment_reconciliations.failure spells them.
const (
	FailureCredentials = "credentials"
	FailureUnavailable = "unavailable"
)

// StaleClaim is how long a run's claim holds. A worker that took a run and
// has not finished it in this long has died with it, and another takes it
// over. It is above the job's timeout, so a run still going is never taken
// from under itself.
const StaleClaim = 2 * time.Hour

// Deps is what a run reads with.
type Deps struct {
	// DB is a pool whose role reaches every tenant's rows.
	DB *sql.DB
	// Secrets decrypts the credentials each source is read with, and
	// Payments is the providers a tenant's payment settings name.
	Secrets  paymentsettings.SecretManager
	Payments *paymentprovider.Registry
	// AppStore and AppStoreVerifier read the App Store's transaction
	// histories, and GooglePlay Google Play's purchases.
	AppStore         AppStoreHistory
	AppStoreVerifier TransactionVerifier
	GooglePlay       GooglePlayReader
	Logger           *slog.Logger
	// Now is the clock, time.Now when nil.
	Now func() time.Time
}

func (d Deps) now() time.Time {
	if d.Now == nil {
		return time.Now()
	}
	return d.Now()
}

func (d Deps) logger() *slog.Logger {
	if d.Logger == nil {
		return slog.Default()
	}
	return d.Logger
}

// Summary is what RunPending did.
type Summary struct {
	Succeeded int
	Failed    int
}

// RunPending runs every reconciliation started and not finished, oldest first,
// until none is left. A run its source fails is recorded as failed and the
// next one is taken up; an error is answered only for what keeps the runs from
// being recorded at all, such as the database.
func RunPending(ctx context.Context, deps Deps) (Summary, error) {
	var summary Summary
	if deps.DB == nil {
		return summary, errors.New("paymentreconciliation: db is nil")
	}
	// Under row-level security every tenant's runs would read as none, and
	// the pass would succeed having run nothing.
	if err := dbroles.RequireEveryTenant(ctx, deps.DB, "payment reconciliation"); err != nil {
		return summary, err
	}
	queries := dbmodels.New(deps.DB)
	for {
		now := deps.now()
		run, err := queries.ClaimPaymentReconciliation(ctx, dbmodels.ClaimPaymentReconciliationParams{
			ClaimedAt:   sql.NullTime{Time: now, Valid: true},
			StaleBefore: sql.NullTime{Time: now.Add(-StaleClaim), Valid: true},
		})
		if errors.Is(err, sql.ErrNoRows) {
			return summary, nil
		}
		if err != nil {
			return summary, fmt.Errorf("claim a payment reconciliation: %w", err)
		}
		ok, err := runOne(ctx, deps, run)
		if err != nil {
			return summary, err
		}
		if ok {
			summary.Succeeded++
		} else {
			summary.Failed++
		}
	}
}

// runOne runs one claimed reconciliation and records what it found, or why
// it failed. It answers whether it succeeded, and an error only when neither
// could be recorded.
func runOne(ctx context.Context, deps Deps, run dbmodels.PaymentReconciliation) (bool, error) {
	logger := deps.logger().With("tenant_id", run.TenantID, "reconciliation_id", run.ID,
		"provider", run.Provider.String, "store", run.Store.String)
	result, err := reconcile(ctx, deps, run)
	if err != nil {
		if ctx.Err() != nil {
			return false, ctx.Err()
		}
		failure := FailureUnavailable
		if errors.Is(err, ErrCredentials) {
			failure = FailureCredentials
		}
		logger.WarnContext(ctx, "payment reconciliation failed", "failure", failure, "error", err)
		if _, err := dbmodels.New(deps.DB).FailPaymentReconciliation(ctx, dbmodels.FailPaymentReconciliationParams{
			Failure:   sql.NullString{String: failure, Valid: true},
			TenantID:  run.TenantID,
			ID:        run.ID,
			ClaimedAt: run.ClaimedAt,
		}); err != nil {
			return false, fmt.Errorf("record a failed payment reconciliation: %w", err)
		}
		return false, nil
	}
	if err := record(ctx, deps.DB, run, result); err != nil {
		return false, err
	}
	logger.InfoContext(ctx, "payment reconciliation completed",
		"record_count", result.RecordCount,
		"purchase_count", result.PurchaseCount,
		"matched_count", result.MatchedCount,
		"finding_count", len(result.Findings),
	)
	return true, nil
}

// reconcile reads both sides of run and matches them.
func reconcile(ctx context.Context, deps Deps, run dbmodels.PaymentReconciliation) (Result, error) {
	queries := dbmodels.New(deps.DB)
	from, to := run.StartsAt, run.EndsAt
	widenedFrom, widenedTo := from.Add(-Margin), to.Add(Margin)

	src, strict, err := sourceFor(ctx, deps, queries, run)
	if err != nil {
		return Result{}, err
	}
	widened, err := queries.ListReconciledPurchasesInPeriod(ctx, dbmodels.ListReconciledPurchasesInPeriodParams{
		TenantID:      run.TenantID,
		PurchasedFrom: widenedFrom,
		PurchasedTo:   widenedTo,
		Provider:      run.Provider,
		Store:         run.Store,
	})
	if err != nil {
		return Result{}, fmt.Errorf("list purchases: %w", err)
	}
	purchases := make([]Purchase, 0, len(widened))
	for _, row := range widened {
		purchases = append(purchases, purchaseOf(row.ID, row.ProviderPaymentID, row.StoreTransactionID, row.PriceAtPurchase, row.RefundedAmount, row.Currency, row.IsTest, row.PurchasedAt, row.CoinPackID))
	}

	records, err := src.records(ctx, widenedFrom, widenedTo, purchases)
	if err != nil {
		return Result{}, err
	}
	in := Input{From: from, To: to, Records: records, Excluded: map[string]bool{}, StrictCurrency: strict}
	for _, p := range purchases {
		if !p.PurchasedAt.Before(from) && p.PurchasedAt.Before(to) {
			in.Purchases = append(in.Purchases, p)
		}
	}
	if in.Named, err = namedPurchases(ctx, queries, run, records); err != nil {
		return Result{}, err
	}
	if run.Provider.Valid {
		ids := paymentIDs(records)
		excluded, err := queries.ListReconciledSubscriptionPaymentIntents(ctx, dbmodels.ListReconciledSubscriptionPaymentIntentsParams{TenantID: run.TenantID, PaymentIds: ids})
		if err != nil {
			return Result{}, fmt.Errorf("list subscription payments: %w", err)
		}
		for _, id := range excluded {
			in.Excluded[id] = true
		}
	}
	if in.Holds, err = holds(ctx, queries, run); err != nil {
		return Result{}, err
	}
	return Match(in), nil
}

// sourceFor answers the source run reads, and whether it charges in the
// tenant's currency alone.
func sourceFor(ctx context.Context, deps Deps, queries *dbmodels.Queries, run dbmodels.PaymentReconciliation) (source, bool, error) {
	switch {
	case run.Provider.Valid:
		if deps.Payments == nil {
			return nil, false, errors.New("paymentreconciliation: no payment providers")
		}
		config, credentials, err := paymentsettings.New(queries, deps.Secrets, deps.Payments, nil, deps.logger()).LoadEnabledSecrets(ctx, run.TenantID)
		if paymentsettings.IsUnavailable(err) {
			return nil, false, fmt.Errorf("%w: %v", ErrCredentials, err)
		}
		if err != nil {
			return nil, false, fmt.Errorf("load payment credentials: %w", err)
		}
		// The tenant moved to another provider since, whose credentials
		// cannot read this one's payments.
		if config.Provider != run.Provider.String {
			return nil, false, fmt.Errorf("%w: the tenant takes payments through %s now", ErrCredentials, config.Provider)
		}
		provider, ok := deps.Payments.Lookup(run.Provider.String)
		if !ok {
			return nil, false, fmt.Errorf("%w: provider %s is not registered", ErrCredentials, run.Provider.String)
		}
		return providerSource{provider: provider, credentials: credentials}, true, nil
	case run.Store.String == storepurchase.StoreAppStore:
		if deps.AppStore == nil || deps.AppStoreVerifier == nil {
			return nil, false, errors.New("paymentreconciliation: no App Store client")
		}
		credentials, err := paymentsettings.NewAppStores(queries, deps.Secrets).LoadAppStoreCredentials(ctx, run.TenantID)
		if err != nil {
			return nil, false, storeCredentialsError(err)
		}
		return appStoreSource{history: deps.AppStore, verifier: deps.AppStoreVerifier, credentials: credentials}, false, nil
	case run.Store.String == storepurchase.StoreGooglePlay:
		if deps.GooglePlay == nil {
			return nil, false, errors.New("paymentreconciliation: no Google Play client")
		}
		credentials, err := paymentsettings.NewAppStores(queries, deps.Secrets).LoadGooglePlayCredentials(ctx, run.TenantID)
		if err != nil {
			return nil, false, storeCredentialsError(err)
		}
		return googlePlaySource{client: deps.GooglePlay, credentials: credentials, now: deps.now()}, false, nil
	}
	return nil, false, fmt.Errorf("paymentreconciliation: run %s names no source", run.ID)
}

func storeCredentialsError(err error) error {
	if errors.Is(err, paymentsettings.ErrStoreNotReady) || paymentsettings.IsUnavailable(err) {
		return fmt.Errorf("%w: %v", ErrCredentials, err)
	}
	return fmt.Errorf("load store credentials: %w", err)
}

// namedPurchases reads the purchases records name, wherever they fall.
func namedPurchases(ctx context.Context, queries *dbmodels.Queries, run dbmodels.PaymentReconciliation, records []Record) ([]Purchase, error) {
	ids := paymentIDs(records)
	if len(ids) == 0 {
		return nil, nil
	}
	var named []Purchase
	if run.Provider.Valid {
		rows, err := queries.ListReconciledPurchasesByPaymentIDs(ctx, dbmodels.ListReconciledPurchasesByPaymentIDsParams{TenantID: run.TenantID, Provider: run.Provider, PaymentIds: ids})
		if err != nil {
			return nil, fmt.Errorf("list the purchases of the payments: %w", err)
		}
		for _, row := range rows {
			named = append(named, purchaseOf(row.ID, row.ProviderPaymentID, row.StoreTransactionID, row.PriceAtPurchase, row.RefundedAmount, row.Currency, row.IsTest, row.PurchasedAt, row.CoinPackID))
		}
		return named, nil
	}
	rows, err := queries.ListReconciledPurchasesByStoreTransactionIDs(ctx, dbmodels.ListReconciledPurchasesByStoreTransactionIDsParams{TenantID: run.TenantID, Store: run.Store, TransactionIds: ids})
	if err != nil {
		return nil, fmt.Errorf("list the purchases of the transactions: %w", err)
	}
	for _, row := range rows {
		named = append(named, purchaseOf(row.ID, row.ProviderPaymentID, row.StoreTransactionID, row.PriceAtPurchase, row.RefundedAmount, row.Currency, row.IsTest, row.PurchasedAt, row.CoinPackID))
	}
	return named, nil
}

// holds reads the refunds and disputes of run's source held since before its
// period began.
func holds(ctx context.Context, queries *dbmodels.Queries, run dbmodels.PaymentReconciliation) ([]Hold, error) {
	var held []Hold
	if run.Store.Valid {
		rows, err := queries.ListHeldStoreRefundsReceivedBefore(ctx, dbmodels.ListHeldStoreRefundsReceivedBeforeParams{TenantID: run.TenantID, Store: run.Store.String, ReceivedBefore: run.StartsAt})
		if err != nil {
			return nil, fmt.Errorf("list held store refunds: %w", err)
		}
		for _, row := range rows {
			held = append(held, Hold{Kind: KindHeldRefund, PaymentID: row.StoreTransactionID, ReceivedAt: row.ReceivedAt})
		}
		return held, nil
	}
	refunds, err := queries.ListHeldRefundsReceivedBefore(ctx, dbmodels.ListHeldRefundsReceivedBeforeParams{TenantID: run.TenantID, Provider: run.Provider.String, ReceivedBefore: run.StartsAt})
	if err != nil {
		return nil, fmt.Errorf("list held refunds: %w", err)
	}
	for _, row := range refunds {
		hold := Hold{Kind: KindHeldRefund, PaymentID: row.ProviderPaymentID, ReceivedAt: row.ReceivedAt}
		if row.RefundedAmount.Valid && row.Currency.Valid {
			hold.RefundedAmount, hold.Currency = int64(row.RefundedAmount.Int32), row.Currency.String
		}
		held = append(held, hold)
	}
	disputes, err := queries.ListHeldDisputesReceivedBefore(ctx, dbmodels.ListHeldDisputesReceivedBeforeParams{TenantID: run.TenantID, Provider: run.Provider.String, ReceivedBefore: run.StartsAt})
	if err != nil {
		return nil, fmt.Errorf("list held disputes: %w", err)
	}
	for _, row := range disputes {
		held = append(held, Hold{Kind: KindHeldDispute, PaymentID: row.ProviderPaymentID, ReceivedAt: row.ReceivedAt})
	}
	return held, nil
}

// record writes result's findings and counts in one transaction, provided
// run's claim is still the one it ran under.
func record(ctx context.Context, db *sql.DB, run dbmodels.PaymentReconciliation, result Result) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin recording a payment reconciliation: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck
	queries := dbmodels.New(tx)
	finished, err := queries.FinishPaymentReconciliation(ctx, dbmodels.FinishPaymentReconciliationParams{
		RecordCount:   sql.NullInt32{Int32: int32(result.RecordCount), Valid: true},
		PurchaseCount: sql.NullInt32{Int32: int32(result.PurchaseCount), Valid: true},
		MatchedCount:  sql.NullInt32{Int32: int32(result.MatchedCount), Valid: true},
		FindingCount:  sql.NullInt32{Int32: int32(len(result.Findings)), Valid: true},
		TenantID:      run.TenantID,
		ID:            run.ID,
		ClaimedAt:     run.ClaimedAt,
	})
	if err != nil {
		return fmt.Errorf("finish a payment reconciliation: %w", err)
	}
	// Another worker took the run over as stale; its own pass records it.
	if finished == 0 {
		return nil
	}
	for _, finding := range result.Findings {
		if err := queries.CreatePaymentReconciliationFinding(ctx, findingParams(run, finding)); err != nil {
			return fmt.Errorf("record a payment reconciliation finding: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit a payment reconciliation: %w", err)
	}
	return nil
}

func findingParams(run dbmodels.PaymentReconciliation, f Finding) dbmodels.CreatePaymentReconciliationFindingParams {
	params := dbmodels.CreatePaymentReconciliationFindingParams{
		ID:                uuid.Must(uuid.NewV7()),
		TenantID:          run.TenantID,
		ReconciliationID:  run.ID,
		Kind:              f.Kind,
		IsTest:            f.Test,
		ProviderPaymentID: sql.NullString{String: f.PaymentID, Valid: f.PaymentID != ""},
		OccurredAt:        f.OccurredAt,
	}
	if p := f.Purchase; p != nil {
		params.PurchaseID = uuid.NullUUID{UUID: p.ID, Valid: true}
		params.PurchaseAmount = sql.NullInt64{Int64: p.Amount, Valid: true}
		params.PurchaseRefundedAmount = sql.NullInt64{Int64: p.RefundedAmount, Valid: true}
		params.PurchaseCurrency = sql.NullString{String: p.Currency, Valid: true}
	}
	if r := f.Record; r != nil {
		if r.Currency != "" {
			params.RecordAmount = sql.NullInt64{Int64: r.Amount, Valid: true}
			params.RecordRefundedAmount = sql.NullInt64{Int64: r.RefundedAmount, Valid: true}
			params.RecordCurrency = sql.NullString{String: r.Currency, Valid: true}
		}
	}
	if h := f.Hold; h != nil && h.Currency != "" {
		params.RecordRefundedAmount = sql.NullInt64{Int64: h.RefundedAmount, Valid: true}
		params.RecordCurrency = sql.NullString{String: h.Currency, Valid: true}
	}
	return params
}

// purchaseOf reads one of the purchase rows the queries answer. A store
// purchase is of the product its price or its pack names.
func purchaseOf(id uuid.UUID, paymentID, transactionID sql.NullString, price int32, refunded int64, currency string, test bool, purchasedAt time.Time, coinPackID uuid.NullUUID) Purchase {
	p := Purchase{
		ID:             id,
		PaymentID:      paymentID.String,
		Amount:         int64(price),
		RefundedAmount: refunded,
		Currency:       currency,
		Test:           test,
		PurchasedAt:    purchasedAt,
	}
	if transactionID.Valid {
		p.PaymentID = transactionID.String
		p.ProductID = storeproduct.ProductID(price)
		if coinPackID.Valid {
			p.ProductID = storeproduct.CoinPackProductID(coinPackID.UUID)
		}
	}
	return p
}

func paymentIDs(records []Record) []string {
	ids := make([]string, 0, len(records))
	for _, r := range records {
		ids = append(ids, r.PaymentID)
	}
	return ids
}
