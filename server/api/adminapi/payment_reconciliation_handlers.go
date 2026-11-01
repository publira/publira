package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/clientip"
	"github.com/publira/publira/server/internal/csvexport"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	"github.com/publira/publira/server/internal/paymentreconciliation"
	"github.com/publira/publira/server/internal/paymentsettings"
	"github.com/publira/publira/server/internal/platformconfig"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/storepurchase"
	"github.com/publira/publira/server/internal/tenanttz"
)

const (
	defaultPaymentReconciliationPageSize = int32(20)
	maxPaymentReconciliationPageSize     = int32(100)

	// paymentReconciliationFindingOrder names the one order the findings are
	// listed in, which a token carries with the filters it was issued for.
	paymentReconciliationFindingOrder = "occurred_at_asc"
)

var (
	errPaymentReconciliationFuture     = errors.New("end_date must not be after today")
	errPaymentReconciliationIDRequired = errors.New("reconciliation_id must be a UUID")
)

// reconciliationPeriod is a period of the tenant's days and the half-open
// range of instants it comes to in the tenant's time zone.
type reconciliationPeriod struct {
	dates    statsPeriod
	timeZone string
	zone     *time.Location
	startsAt time.Time
	endsAt   time.Time
}

// reconciliationPeriodOf reads a request's dates in tenant's time zone.
func (s *adminServer) reconciliationPeriodOf(ctx context.Context, tenant dbmodels.Tenant, rawStart, rawEnd string) (reconciliationPeriod, error) {
	dates, err := parseStatsPeriod(rawStart, rawEnd)
	if err != nil {
		return reconciliationPeriod{}, err
	}
	timeZone := tenanttz.Resolve(tenant.Timezone, platformconfig.DefaultTimeZoneFunc(ctx, s.queriesFor(ctx)))
	zone, err := time.LoadLocation(timeZone)
	if err != nil {
		return reconciliationPeriod{}, s.internalError(ctx, "failed to load the tenant time zone", err,
			"tenant_id", tenant.ID.String(), "time_zone", timeZone)
	}
	midnight := func(day time.Time) time.Time {
		return time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, zone)
	}
	return reconciliationPeriod{
		dates:    dates,
		timeZone: timeZone,
		zone:     zone,
		startsAt: midnight(dates.start),
		endsAt:   midnight(dates.end.AddDate(0, 0, 1)),
	}, nil
}

// reconciliationSource is one source a run reads: a provider's id, or a
// store's name.
type reconciliationSource struct {
	provider string
	store    string
}

// StartPaymentReconciliation writes a run of the period for every source the
// tenant has ready, for the worker to take up.
func (s *adminServer) StartPaymentReconciliation(
	ctx context.Context,
	req *publiraadminv1.StartPaymentReconciliationRequest,
) (*publiraadminv1.StartPaymentReconciliationResponse, error) {
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	period, err := s.reconciliationPeriodOf(ctx, tenant, req.StartDate, req.EndDate)
	if err != nil {
		return nil, err
	}
	now := time.Now().In(period.zone)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	if period.dates.end.After(today) {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errPaymentReconciliationFuture, "end_date")
	}

	sources, err := s.reconciliationSources(ctx, tenant.ID)
	if err != nil {
		return nil, err
	}
	if len(sources) == 0 {
		return nil, connect.NewError(connect.CodeFailedPrecondition, "no payment provider or store is ready to reconcile with")
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin a payment reconciliation transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txq := dbmodels.New(tx)
	runs := make([]dbmodels.PaymentReconciliation, 0, len(sources))
	for _, source := range sources {
		run, err := startReconciliation(ctx, txq, tenant.ID, period, source)
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to start a payment reconciliation", err, "tenant_id", tenant.ID.String())
		}
		runs = append(runs, run)
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit a payment reconciliation", err, "tenant_id", tenant.ID.String())
	}

	s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
		TenantID: tenant.ID, ActorUserID: sessionCtx.User.ID, ActorRole: sessionCtx.Role,
		Action: "payment_reconciliation_started", TargetType: "payment_reconciliation", TargetID: statsPeriodID(period.dates),
		Outcome: auditlog.OutcomeSuccess, ClientIP: clientip.FromContext(ctx),
	})

	res := &publiraadminv1.StartPaymentReconciliationResponse{}
	for _, run := range runs {
		res.Reconciliations = append(res.Reconciliations, paymentReconciliationToProto(run))
	}
	return res, nil
}

// reconciliationSources answers the sources the tenant has ready, in the order
// provider, App Store, Google Play.
func (s *adminServer) reconciliationSources(ctx context.Context, tenantID uuid.UUID) ([]reconciliationSource, error) {
	var sources []reconciliationSource
	payment, err := s.paymentStore(ctx).GetPublic(ctx, tenantID)
	if err != nil {
		return nil, s.internalError(ctx, "failed to read the payment settings", err, "tenant_id", tenantID.String())
	}
	if payment.Enabled && payment.Ready && payment.Provider != "" {
		sources = append(sources, reconciliationSource{provider: payment.Provider})
	}
	stores, err := paymentsettings.NewAppStores(s.queriesFor(ctx), s.encryptor).Get(ctx, tenantID)
	if err != nil {
		return nil, s.internalError(ctx, "failed to read the store settings", err, "tenant_id", tenantID.String())
	}
	if stores.AppStore.Ready {
		sources = append(sources, reconciliationSource{store: storepurchase.StoreAppStore})
	}
	if stores.GooglePlay.Ready {
		sources = append(sources, reconciliationSource{store: storepurchase.StoreGooglePlay})
	}
	return sources, nil
}

// startReconciliation replaces the finished run of the period and source with
// a new one, or answers the run the worker has not finished.
func startReconciliation(ctx context.Context, q *dbmodels.Queries, tenantID uuid.UUID, period reconciliationPeriod, source reconciliationSource) (dbmodels.PaymentReconciliation, error) {
	provider := sql.NullString{String: source.provider, Valid: source.provider != ""}
	store := sql.NullString{String: source.store, Valid: source.store != ""}
	if err := q.DeleteFinishedPaymentReconciliation(ctx, dbmodels.DeleteFinishedPaymentReconciliationParams{
		TenantID: tenantID, Provider: provider, Store: store,
		StartDate: period.dates.start, EndDate: period.dates.end,
	}); err != nil {
		return dbmodels.PaymentReconciliation{}, err
	}
	run, err := q.CreatePaymentReconciliation(ctx, dbmodels.CreatePaymentReconciliationParams{
		ID:        uuid.Must(uuid.NewV7()),
		TenantID:  tenantID,
		Provider:  provider,
		Store:     store,
		StartDate: period.dates.start,
		EndDate:   period.dates.end,
		TimeZone:  period.timeZone,
		StartsAt:  period.startsAt,
		EndsAt:    period.endsAt,
	})
	if !errors.Is(err, sql.ErrNoRows) {
		return run, err
	}
	return q.GetPaymentReconciliationForPeriod(ctx, dbmodels.GetPaymentReconciliationForPeriodParams{
		TenantID: tenantID, Provider: provider, Store: store,
		StartDate: period.dates.start, EndDate: period.dates.end,
	})
}

// ListPaymentReconciliations lists the tenant's runs, the one started last
// first.
func (s *adminServer) ListPaymentReconciliations(
	ctx context.Context,
	req *publiraadminv1.ListPaymentReconciliationsRequest,
) (*publiraadminv1.ListPaymentReconciliationsResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}

	limit := pagination.NormalizeLimit(req.Limit, defaultPaymentReconciliationPageSize, maxPaymentReconciliationPageSize)
	cursor, err := pagination.Decode(req.Token)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, "token is invalid")
	}
	var keys pagination.TimeUUIDKeys
	if !cursor.IsZero() {
		if keys, err = pagination.DecodeTimeUUID(cursor); err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, "token is invalid")
		}
	}

	queries := s.queriesFor(ctx)
	var rows []dbmodels.PaymentReconciliation
	if cursor.Direction == pagination.Backward {
		rows, err = queries.ListPaymentReconciliationsAsc(ctx, dbmodels.ListPaymentReconciliationsAscParams{
			TenantID:        tenant.ID,
			CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
			CursorInclusive: keys.Inclusive,
			CursorStartedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
			Limit:           limit + 1,
		})
	} else {
		rows, err = queries.ListPaymentReconciliationsDesc(ctx, dbmodels.ListPaymentReconciliationsDescParams{
			TenantID:        tenant.ID,
			CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
			CursorInclusive: keys.Inclusive,
			CursorStartedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
			Limit:           limit + 1,
		})
	}
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list payment reconciliations", err, "tenant_id", tenant.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	res := &publiraadminv1.ListPaymentReconciliationsResponse{}
	for _, row := range rows {
		res.Reconciliations = append(res.Reconciliations, paymentReconciliationToProto(row))
	}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = pagination.EncodeTimeUUID(pagination.Backward, rows[0].StartedAt, rows[0].ID)
		}
		if hasNext {
			last := rows[len(rows)-1]
			res.NextToken = pagination.EncodeTimeUUID(pagination.Forward, last.StartedAt, last.ID)
		}
	// An empty page means the boundary row was replaced after the token was
	// issued: recover once, toward where the client came from.
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		res.PreviousToken = pagination.EncodeTimeUUIDRecovery(pagination.Backward, keys.Time, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		res.NextToken = pagination.EncodeTimeUUIDRecovery(pagination.Forward, keys.Time, keys.ID)
	}
	return res, nil
}

// ListPaymentReconciliationFindings lists one run's findings in the order
// they happened.
func (s *adminServer) ListPaymentReconciliationFindings(
	ctx context.Context,
	req *publiraadminv1.ListPaymentReconciliationFindingsRequest,
) (*publiraadminv1.ListPaymentReconciliationFindingsResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}
	runID, err := uuid.Parse(req.ReconciliationId)
	if err != nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errPaymentReconciliationIDRequired, "reconciliation_id")
	}
	queries := s.queriesFor(ctx)
	if _, err := queries.GetPaymentReconciliation(ctx, dbmodels.GetPaymentReconciliationParams{TenantID: tenant.ID, ID: runID}); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, "payment reconciliation not found")
		}
		return nil, s.internalDBError(ctx, "failed to get a payment reconciliation", err, "tenant_id", tenant.ID.String())
	}

	kind := sql.NullString{String: findingKindToDB(req.Kind), Valid: req.Kind != publiraadminv1.PaymentReconciliationFindingKind_PAYMENT_RECONCILIATION_FINDING_KIND_UNSPECIFIED}
	if kind.Valid && kind.String == "" {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("kind is not a finding kind"), "kind")
	}
	var isTest sql.NullBool
	mode := ""
	switch req.Mode {
	case publiraadminv1.PaymentReconciliationMode_PAYMENT_RECONCILIATION_MODE_UNSPECIFIED:
	case publiraadminv1.PaymentReconciliationMode_PAYMENT_RECONCILIATION_MODE_LIVE:
		isTest, mode = sql.NullBool{Bool: false, Valid: true}, "live"
	case publiraadminv1.PaymentReconciliationMode_PAYMENT_RECONCILIATION_MODE_TEST:
		isTest, mode = sql.NullBool{Bool: true, Valid: true}, "test"
	default:
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("mode is not a mode"), "mode")
	}
	listKey := pagination.NewListKey(paymentReconciliationFindingOrder).
		Value("reconciliation", runID.String()).
		Value("kind", kind.String).
		Value("mode", mode)

	limit := pagination.NormalizeLimit(req.Limit, defaultPaymentReconciliationPageSize, maxPaymentReconciliationPageSize)
	cursor, err := pagination.Decode(req.Token)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, "token is invalid")
	}
	var keys pagination.TimeUUIDKeys
	if !cursor.IsZero() {
		if keys, err = listKey.DecodeTimeUUID(cursor); err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, "token is invalid")
		}
	}

	var rows []dbmodels.PaymentReconciliationFinding
	if cursor.Direction == pagination.Backward {
		rows, err = queries.ListPaymentReconciliationFindingsDesc(ctx, dbmodels.ListPaymentReconciliationFindingsDescParams{
			TenantID:         tenant.ID,
			ReconciliationID: runID,
			Kind:             kind,
			IsTest:           isTest,
			CursorID:         uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
			CursorInclusive:  keys.Inclusive,
			CursorOccurredAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
			Limit:            limit + 1,
		})
	} else {
		rows, err = queries.ListPaymentReconciliationFindingsAsc(ctx, dbmodels.ListPaymentReconciliationFindingsAscParams{
			TenantID:         tenant.ID,
			ReconciliationID: runID,
			Kind:             kind,
			IsTest:           isTest,
			CursorID:         uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
			CursorInclusive:  keys.Inclusive,
			CursorOccurredAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
			Limit:            limit + 1,
		})
	}
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list payment reconciliation findings", err, "tenant_id", tenant.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	res := &publiraadminv1.ListPaymentReconciliationFindingsResponse{}
	for _, row := range rows {
		res.Findings = append(res.Findings, paymentReconciliationFindingToProto(row))
	}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = listKey.EncodeTimeUUID(pagination.Backward, rows[0].OccurredAt, rows[0].ID)
		}
		if hasNext {
			last := rows[len(rows)-1]
			res.NextToken = listKey.EncodeTimeUUID(pagination.Forward, last.OccurredAt, last.ID)
		}
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		res.PreviousToken = listKey.EncodeTimeUUIDRecovery(pagination.Backward, keys.Time, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		res.NextToken = listKey.EncodeTimeUUIDRecovery(pagination.Forward, keys.Time, keys.ID)
	}
	return res, nil
}

// ExportPurchases writes the purchases and refunds of a period as CSV.
func (s *adminServer) ExportPurchases(
	ctx context.Context,
	req *publiraadminv1.ExportPurchasesRequest,
) (*publiraadminv1.ExportPurchasesResponse, error) {
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	period, err := s.reconciliationPeriodOf(ctx, tenant, req.StartDate, req.EndDate)
	if err != nil {
		return nil, err
	}
	rows, err := s.queriesFor(ctx).ListPurchasesForExport(ctx, dbmodels.ListPurchasesForExportParams{
		TenantID: tenant.ID,
		StartsAt: period.startsAt,
		EndsAt:   period.endsAt,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list the purchases to export", err, "tenant_id", tenant.ID.String())
	}

	w := csvexport.New("row_type", "purchase_id", "occurred_at", "purchased_at", "amount", "currency",
		"kind", "item_type", "item_id", "provider", "provider_checkout_id", "provider_payment_id",
		"store", "store_transaction_id", "test")
	at := func(t time.Time) string { return t.In(period.zone).Format(time.RFC3339) }
	for _, row := range rows {
		itemType, itemID := purchaseExportItem(row)
		line := func(rowType, occurredAt string, amount int64) {
			w.Row(rowType, row.ID.String(), occurredAt, at(row.PurchasedAt), strconv.FormatInt(amount, 10), row.Currency,
				row.Kind, itemType, itemID, row.Provider.String, row.ProviderCheckoutID.String, row.ProviderPaymentID.String,
				row.Store.String, row.StoreTransactionID.String, strconv.FormatBool(row.IsTest))
		}
		if row.PurchasedInPeriod {
			line("purchase", at(row.PurchasedAt), int64(row.PriceAtPurchase))
		}
		if row.RefundedInPeriod {
			refundedAt := ""
			if row.RefundedAt.Valid {
				refundedAt = at(row.RefundedAt.Time)
			}
			line("refund", refundedAt, row.RefundedAmount)
		}
	}

	s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
		TenantID: tenant.ID, ActorUserID: sessionCtx.User.ID, ActorRole: sessionCtx.Role,
		Action: "purchases_exported", TargetType: "purchases", TargetID: statsPeriodID(period.dates),
		Outcome: auditlog.OutcomeSuccess, ClientIP: clientip.FromContext(ctx),
	})
	return &publiraadminv1.ExportPurchasesResponse{Csv: w.Bytes()}, nil
}

// purchaseExportItem names what a purchase bought.
func purchaseExportItem(row dbmodels.ListPurchasesForExportRow) (string, string) {
	switch {
	case row.VolumeID.Valid:
		return "volume", row.VolumeID.UUID.String()
	case row.SeriesBundleID.Valid:
		return "series_bundle", row.SeriesBundleID.UUID.String()
	case row.CoinPackID.Valid:
		return "coin_pack", row.CoinPackID.UUID.String()
	case row.EpisodeID.Valid:
		return "episode", row.EpisodeID.UUID.String()
	}
	return "", ""
}

func paymentReconciliationToProto(run dbmodels.PaymentReconciliation) *publiraadminv1.PaymentReconciliation {
	out := &publiraadminv1.PaymentReconciliation{
		Id:            run.ID.String(),
		Provider:      run.Provider.String,
		Store:         run.Store.String,
		StartDate:     run.StartDate.Format(time.DateOnly),
		EndDate:       run.EndDate.Format(time.DateOnly),
		StartedAt:     run.StartedAt.UTC().Format(time.RFC3339),
		RecordCount:   int64(run.RecordCount.Int32),
		PurchaseCount: int64(run.PurchaseCount.Int32),
		MatchedCount:  int64(run.MatchedCount.Int32),
		FindingCount:  int64(run.FindingCount.Int32),
	}
	switch {
	case run.FinishedAt.Valid && run.Failure.Valid:
		out.Status = publiraadminv1.PaymentReconciliationStatus_PAYMENT_RECONCILIATION_STATUS_FAILED
		out.Failure = publiraadminv1.PaymentReconciliationFailure_PAYMENT_RECONCILIATION_FAILURE_UNAVAILABLE
		if run.Failure.String == paymentreconciliation.FailureCredentials {
			out.Failure = publiraadminv1.PaymentReconciliationFailure_PAYMENT_RECONCILIATION_FAILURE_CREDENTIALS
		}
	case run.FinishedAt.Valid:
		out.Status = publiraadminv1.PaymentReconciliationStatus_PAYMENT_RECONCILIATION_STATUS_SUCCEEDED
	case run.ClaimedAt.Valid:
		out.Status = publiraadminv1.PaymentReconciliationStatus_PAYMENT_RECONCILIATION_STATUS_RUNNING
	default:
		out.Status = publiraadminv1.PaymentReconciliationStatus_PAYMENT_RECONCILIATION_STATUS_PENDING
	}
	if run.FinishedAt.Valid {
		out.FinishedAt = run.FinishedAt.Time.UTC().Format(time.RFC3339)
	}
	return out
}

var findingKinds = map[string]publiraadminv1.PaymentReconciliationFindingKind{
	paymentreconciliation.KindRecordUnmatched:   publiraadminv1.PaymentReconciliationFindingKind_PAYMENT_RECONCILIATION_FINDING_KIND_RECORD_UNMATCHED,
	paymentreconciliation.KindPurchaseUnmatched: publiraadminv1.PaymentReconciliationFindingKind_PAYMENT_RECONCILIATION_FINDING_KIND_PURCHASE_UNMATCHED,
	paymentreconciliation.KindAmountMismatch:    publiraadminv1.PaymentReconciliationFindingKind_PAYMENT_RECONCILIATION_FINDING_KIND_AMOUNT_MISMATCH,
	paymentreconciliation.KindHeldRefund:        publiraadminv1.PaymentReconciliationFindingKind_PAYMENT_RECONCILIATION_FINDING_KIND_HELD_REFUND,
	paymentreconciliation.KindHeldDispute:       publiraadminv1.PaymentReconciliationFindingKind_PAYMENT_RECONCILIATION_FINDING_KIND_HELD_DISPUTE,
}

// findingKindToDB answers the stored kind kind names, and empty for one that
// names none.
func findingKindToDB(kind publiraadminv1.PaymentReconciliationFindingKind) string {
	for stored, value := range findingKinds {
		if value == kind {
			return stored
		}
	}
	return ""
}

func paymentReconciliationFindingToProto(row dbmodels.PaymentReconciliationFinding) *publiraadminv1.PaymentReconciliationFinding {
	out := &publiraadminv1.PaymentReconciliationFinding{
		Id:                     row.ID.String(),
		Kind:                   findingKinds[row.Kind],
		Test:                   row.IsTest,
		ProviderPaymentId:      row.ProviderPaymentID.String,
		PurchaseAmount:         row.PurchaseAmount.Int64,
		PurchaseRefundedAmount: row.PurchaseRefundedAmount.Int64,
		PurchaseCurrency:       row.PurchaseCurrency.String,
		RecordAmount:           row.RecordAmount.Int64,
		RecordRefundedAmount:   row.RecordRefundedAmount.Int64,
		RecordCurrency:         row.RecordCurrency.String,
		OccurredAt:             row.OccurredAt.UTC().Format(time.RFC3339),
	}
	if row.PurchaseID.Valid {
		out.PurchaseId = row.PurchaseID.UUID.String()
	}
	return out
}
