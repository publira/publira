package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/clientip"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentsettings"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
)

const (
	defaultPurchaseListLimit = int32(20)
	maxPurchaseListLimit     = int32(100)

	// purchaseRefundTimeout bounds the work RefundPurchase finishes once it
	// has revoked a purchase, the provider's answer and taking the revocation
	// back included, however the request that started it ends.
	purchaseRefundTimeout = 90 * time.Second

	purchaseRevocationRefund  = "refund"
	purchaseRevocationDispute = "dispute"
	purchaseRevocationStaff   = "staff"
)

// purchaseRefundIdempotencyKey is the key every request of one attempt to
// refund a purchase is sent under, so a provider refunds a purchase once
// however many times staff ask, until the provider has refused or failed the
// refund and the purchase has moved on to its next attempt.
func purchaseRefundIdempotencyKey(purchaseID uuid.UUID, attempt int32) string {
	return fmt.Sprintf("publira-purchase-refund-%s-%d", purchaseID, attempt)
}

func purchaseRevocationReasonToProto(reason sql.NullString) publiraadminv1.PurchaseRevocationReason {
	switch reason.String {
	case purchaseRevocationRefund:
		return publiraadminv1.PurchaseRevocationReason_PURCHASE_REVOCATION_REASON_REFUND
	case purchaseRevocationDispute:
		return publiraadminv1.PurchaseRevocationReason_PURCHASE_REVOCATION_REASON_DISPUTE
	case purchaseRevocationStaff:
		return publiraadminv1.PurchaseRevocationReason_PURCHASE_REVOCATION_REASON_STAFF
	default:
		return publiraadminv1.PurchaseRevocationReason_PURCHASE_REVOCATION_REASON_UNSPECIFIED
	}
}

// purchaseRefundable reports whether RefundPurchase would ask a provider to
// refund row under the tenant's payment settings payments.
func purchaseRefundable(row dbmodels.ListPurchasesForTenantByIDsRow, payments paymentsettings.PublicConfig) bool {
	return payments.Enabled &&
		payments.Ready &&
		row.Provider.Valid &&
		row.Provider.String == payments.Provider &&
		row.ProviderPaymentID.Valid &&
		!row.RefundedAt.Valid &&
		!row.RevokedAt.Valid
}

func mapPurchase(row dbmodels.ListPurchasesForTenantByIDsRow, payments paymentsettings.PublicConfig) *publiraadminv1.AdminPurchase {
	return &publiraadminv1.AdminPurchase{
		Id:               row.ID.String(),
		EpisodeId:        row.EpisodeID.String(),
		EpisodePublicId:  row.EpisodePublicID,
		EpisodeTitle:     row.EpisodeTitle,
		SeriesPublicId:   row.SeriesPublicID,
		SeriesTitle:      row.SeriesTitle,
		ReaderPublicId:   formatOptionalString(row.ReaderPublicID),
		ReaderName:       formatOptionalString(row.ReaderName),
		ReaderEmail:      formatOptionalString(row.ReaderEmail),
		Price:            int64(row.PriceAtPurchase),
		Currency:         row.Currency,
		PurchasedAt:      row.PurchasedAt.UTC().Format(time.RFC3339),
		ExpiresAt:        formatOptionalTime(row.ExpiresAt),
		Provider:         formatOptionalString(row.Provider),
		Store:            formatOptionalString(row.Store),
		Test:             row.IsTest,
		RefundedAmount:   int64(row.RefundedAmount.Int32),
		RefundedAt:       formatOptionalTime(row.RefundedAt),
		RevokedAt:        formatOptionalTime(row.RevokedAt),
		RevocationReason: purchaseRevocationReasonToProto(row.RevocationReason),
		Refundable:       purchaseRefundable(row, payments),
	}
}

// purchasePageFilter is the part of a page query that stays the same while the
// client walks pages: the tenant and the optional list filters.
type purchasePageFilter struct {
	tenantID      uuid.UUID
	seriesID      uuid.NullUUID
	episodeID     uuid.NullUUID
	readerEmail   sql.NullString
	purchasedFrom sql.NullTime
	purchasedTo   sql.NullTime
}

// purchasePageKey is the sort key of one row of a purchase page.
type purchasePageKey struct {
	id          uuid.UUID
	purchasedAt time.Time
}

// purchasePage runs the keyset query for one page. The list reads newest
// first, so a backward page is scanned by the ascending query and put back into
// display order by pagination.Page.
func (s *adminServer) purchasePage(
	ctx context.Context,
	filter purchasePageFilter,
	keys pagination.TimeUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]purchasePageKey, error) {
	queries := s.queriesFor(ctx)
	cursorID := uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid}
	cursorPurchasedAt := sql.NullTime{Time: keys.Time, Valid: keys.Valid}
	if direction == pagination.Backward {
		rows, err := queries.ListPurchaseIDsForTenantAsc(ctx, dbmodels.ListPurchaseIDsForTenantAscParams{
			TenantID:          filter.tenantID,
			SeriesID:          filter.seriesID,
			EpisodeID:         filter.episodeID,
			ReaderEmail:       filter.readerEmail,
			PurchasedFrom:     filter.purchasedFrom,
			PurchasedTo:       filter.purchasedTo,
			CursorID:          cursorID,
			CursorInclusive:   keys.Inclusive,
			CursorPurchasedAt: cursorPurchasedAt,
			Limit:             limit,
		})
		if err != nil {
			return nil, err
		}
		page := make([]purchasePageKey, 0, len(rows))
		for _, row := range rows {
			page = append(page, purchasePageKey{id: row.ID, purchasedAt: row.PurchasedAt})
		}
		return page, nil
	}

	rows, err := queries.ListPurchaseIDsForTenantDesc(ctx, dbmodels.ListPurchaseIDsForTenantDescParams{
		TenantID:          filter.tenantID,
		SeriesID:          filter.seriesID,
		EpisodeID:         filter.episodeID,
		ReaderEmail:       filter.readerEmail,
		PurchasedFrom:     filter.purchasedFrom,
		PurchasedTo:       filter.purchasedTo,
		CursorID:          cursorID,
		CursorInclusive:   keys.Inclusive,
		CursorPurchasedAt: cursorPurchasedAt,
		Limit:             limit,
	})
	if err != nil {
		return nil, err
	}
	page := make([]purchasePageKey, 0, len(rows))
	for _, row := range rows {
		page = append(page, purchasePageKey{id: row.ID, purchasedAt: row.PurchasedAt})
	}
	return page, nil
}

// loadPurchases reads what the console shows of the purchases ids names, in
// the order ids names them. An id that names no purchase of the tenant is left
// out.
func (s *adminServer) loadPurchases(ctx context.Context, tenantID uuid.UUID, ids []uuid.UUID) ([]dbmodels.ListPurchasesForTenantByIDsRow, error) {
	rows, err := s.queriesFor(ctx).ListPurchasesForTenantByIDs(ctx, dbmodels.ListPurchasesForTenantByIDsParams{
		TenantID: tenantID,
		Ids:      ids,
	})
	if err != nil {
		return nil, err
	}
	byID := make(map[uuid.UUID]dbmodels.ListPurchasesForTenantByIDsRow, len(rows))
	for _, row := range rows {
		byID[row.ID] = row
	}
	ordered := make([]dbmodels.ListPurchasesForTenantByIDsRow, 0, len(rows))
	for _, id := range ids {
		if row, ok := byID[id]; ok {
			ordered = append(ordered, row)
		}
	}
	return ordered, nil
}

// loadPurchase reads one purchase of the tenant, answering not_found for an
// id that names none.
func (s *adminServer) loadPurchase(ctx context.Context, tenantID, purchaseID uuid.UUID) (dbmodels.ListPurchasesForTenantByIDsRow, error) {
	rows, err := s.loadPurchases(ctx, tenantID, []uuid.UUID{purchaseID})
	if err != nil {
		return dbmodels.ListPurchasesForTenantByIDsRow{}, s.internalDBError(ctx, "failed to get purchase", err, "tenant_id", tenantID.String(), "purchase_id", purchaseID.String())
	}
	if len(rows) == 0 {
		return dbmodels.ListPurchasesForTenantByIDsRow{}, connect.NewError(connect.CodeNotFound, "purchase not found")
	}
	return rows[0], nil
}

func (s *adminServer) ListPurchases(
	ctx context.Context,
	req *publiraadminv1.ListPurchasesRequest,
) (*publiraadminv1.ListPurchasesResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}

	limit := pagination.NormalizeLimit(req.Limit, defaultPurchaseListLimit, maxPurchaseListLimit)
	cursor, err := pagination.Decode(req.Token)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, "token is invalid")
	}
	purchasedFrom, err := parseTimeFilter("purchased_from", req.PurchasedFrom)
	if err != nil {
		return nil, err
	}
	purchasedTo, err := parseTimeFilter("purchased_to", req.PurchasedTo)
	if err != nil {
		return nil, err
	}
	if purchasedFrom.Valid && purchasedTo.Valid && !purchasedFrom.Time.Before(purchasedTo.Time) {
		return nil, connect.NewError(connect.CodeInvalidArgument, "purchased_from must be before purchased_to")
	}
	seriesPublicID := strings.TrimSpace(req.SeriesPublicId)
	episodePublicID := strings.TrimSpace(req.EpisodePublicId)
	// The address is matched regardless of case, so the token names it in one.
	readerEmail := strings.ToLower(strings.TrimSpace(req.ReaderEmail))
	listKey := pagination.NewListKey("purchased_at_desc").
		Value("series_public_id", seriesPublicID).
		Value("episode_public_id", episodePublicID).
		Value("reader_email", readerEmail).
		Time("purchased_from", purchasedFrom.Time, purchasedFrom.Valid).
		Time("purchased_to", purchasedTo.Time, purchasedTo.Valid)
	var keys pagination.TimeUUIDKeys
	if !cursor.IsZero() {
		keys, err = listKey.DecodeTimeUUID(cursor)
		if err != nil {
			return nil, rpcerrors.NewPageTokenError(err)
		}
	}

	filter := purchasePageFilter{
		tenantID:      tenant.ID,
		readerEmail:   sql.NullString{String: readerEmail, Valid: readerEmail != ""},
		purchasedFrom: purchasedFrom,
		purchasedTo:   purchasedTo,
	}
	empty := &publiraadminv1.ListPurchasesResponse{Purchases: []*publiraadminv1.AdminPurchase{}}
	if seriesPublicID != "" {
		series, err := s.queriesFor(ctx).GetSeriesByPublicIDForTenant(ctx, dbmodels.GetSeriesByPublicIDForTenantParams{
			TenantID: tenant.ID,
			PublicID: seriesPublicID,
		})
		if errors.Is(err, sql.ErrNoRows) {
			return empty, nil
		}
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to resolve series for list purchases", err, "tenant_id", tenant.ID.String())
		}
		filter.seriesID = uuid.NullUUID{UUID: series.ID, Valid: true}
	}
	if episodePublicID != "" {
		episode, err := s.queriesFor(ctx).GetEpisodeByPublicIDForTenant(ctx, dbmodels.GetEpisodeByPublicIDForTenantParams{
			TenantID: tenant.ID,
			PublicID: episodePublicID,
		})
		if errors.Is(err, sql.ErrNoRows) {
			return empty, nil
		}
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to resolve episode for list purchases", err, "tenant_id", tenant.ID.String())
		}
		filter.episodeID = uuid.NullUUID{UUID: episode.ID, Valid: true}
	}

	// One row past the page: its presence is what says another page exists.
	page, err := s.purchasePage(ctx, filter, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list purchases", err, "tenant_id", tenant.ID.String())
	}
	page, hasMore := pagination.Page(page, limit, cursor.Direction)

	ids := make([]uuid.UUID, 0, len(page))
	for _, key := range page {
		ids = append(ids, key.id)
	}
	rows, err := s.loadPurchases(ctx, tenant.ID, ids)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to load listed purchases", err, "tenant_id", tenant.ID.String())
	}
	payments, err := s.paymentStore(ctx).GetPublic(ctx, tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get payment settings for list purchases", err, "tenant_id", tenant.ID.String())
	}
	purchases := make([]*publiraadminv1.AdminPurchase, 0, len(rows))
	for _, row := range rows {
		purchases = append(purchases, mapPurchase(row, payments))
	}

	res := &publiraadminv1.ListPurchasesResponse{Purchases: purchases}
	switch {
	case len(page) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = listKey.EncodeTimeUUID(pagination.Backward, page[0].purchasedAt, page[0].id)
		}
		if hasNext {
			last := page[len(page)-1]
			res.NextToken = listKey.EncodeTimeUUID(pagination.Forward, last.purchasedAt, last.id)
		}
	// An empty page means the boundary row went away after the token was
	// issued. Hand back a token to where the client came from, once: a recovery
	// token that comes back empty leaves both tokens empty.
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		res.PreviousToken = listKey.EncodeTimeUUIDRecovery(pagination.Backward, keys.Time, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		res.NextToken = listKey.EncodeTimeUUIDRecovery(pagination.Forward, keys.Time, keys.ID)
	}
	return res, nil
}

func (s *adminServer) GetPurchase(
	ctx context.Context,
	req *publiraadminv1.GetPurchaseRequest,
) (*publiraadminv1.GetPurchaseResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}
	purchaseID, err := parseRecordID(req.PurchaseId, "purchase_id")
	if err != nil {
		return nil, err
	}

	row, err := s.loadPurchase(ctx, tenant.ID, purchaseID)
	if err != nil {
		return nil, err
	}
	payments, err := s.paymentStore(ctx).GetPublic(ctx, tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get payment settings for get purchase", err, "tenant_id", tenant.ID.String())
	}
	return &publiraadminv1.GetPurchaseResponse{Purchase: mapPurchase(row, payments)}, nil
}

func (s *adminServer) RefundPurchase(
	ctx context.Context,
	req *publiraadminv1.RefundPurchaseRequest,
) (*publiraadminv1.RefundPurchaseResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	purchaseID, err := parseRecordID(req.PurchaseId, "purchase_id")
	if err != nil {
		return nil, err
	}
	// The audit entry is the only record of who gave the reader their money
	// back, and one with no reason leaves the tenant unable to say why.
	reason := strings.TrimSpace(req.Reason)
	if reason == "" {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("reason is required"), "reason")
	}

	row, err := s.loadPurchase(ctx, tenant.ID, purchaseID)
	if err != nil {
		return nil, err
	}
	store := s.paymentStore(ctx)
	// A purchase refunded in full has nothing left to refund, so it comes back
	// as it is. One staff revoked without a refund recorded yet is asked of the
	// provider again under the same idempotency key, which refunds nothing
	// twice: the provider answers with the refund that key made, or makes it
	// now when the earlier request never reached the provider.
	if row.RefundedAt.Valid {
		payments, err := store.GetPublic(ctx, tenant.ID)
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to get payment settings for refund purchase", err, "tenant_id", tenant.ID.String())
		}
		return &publiraadminv1.RefundPurchaseResponse{Purchase: mapPurchase(row, payments)}, nil
	}
	switch {
	case row.RevocationReason.String == purchaseRevocationDispute:
		return nil, connect.NewError(connect.CodeFailedPrecondition, "a disputed purchase is settled through the dispute")
	case row.Store.Valid:
		return nil, connect.NewError(connect.CodeFailedPrecondition, "a store purchase is refunded through the store")
	case !row.Provider.Valid:
		return nil, connect.NewError(connect.CodeFailedPrecondition, "the purchase was made without a payment")
	case !row.ProviderPaymentID.Valid:
		return nil, connect.NewError(connect.CodeFailedPrecondition, "the payment provider reported no payment for the purchase")
	}

	payments, credentials, err := store.LoadEnabledSecrets(ctx, tenant.ID)
	if paymentsettings.IsUnavailable(err) {
		return nil, connect.NewError(connect.CodeFailedPrecondition, "the tenant's payment settings are not enabled")
	}
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to load payment settings for refund purchase", err, "tenant_id", tenant.ID.String())
	}
	if payments.Provider != row.Provider.String {
		return nil, connect.NewError(connect.CodeFailedPrecondition, "the purchase was paid through a payment provider the tenant no longer uses")
	}
	provider, ok := s.paymentProviders.Lookup(row.Provider.String)
	if !ok {
		return nil, connect.NewError(connect.CodeFailedPrecondition, "the purchase was paid through a payment provider this server does not register")
	}

	// The purchase stops opening the episode before the provider is asked, so
	// that whatever the provider then reports, the refund recorded or the
	// refund failed, lands on a purchase already revoked. No row is a purchase
	// something revoked in the meantime: an earlier or a concurrent request for
	// the same refund, or the reader's dispute. Only the request that revoked
	// it takes the revocation back.
	//
	// From here on the work runs on a context the request's end does not
	// cancel, so a caller that hangs up or times out cannot leave a revocation
	// behind with neither the refund it stands for nor its retraction.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), purchaseRefundTimeout)
	defer cancel()
	queries := s.queriesFor(ctx)
	_, err = queries.RevokePurchaseForStaff(ctx, dbmodels.RevokePurchaseForStaffParams{
		TenantID: tenant.ID,
		ID:       row.ID,
	})
	revokedHere := err == nil
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, s.internalDBError(ctx, "failed to revoke a purchase staff are refunding", err, "tenant_id", tenant.ID.String(), "purchase_id", row.ID.String())
	}
	// liftRevocation takes this request's revocation back for a refund that
	// did not happen, moving the purchase on to its next attempt when the
	// provider refused or failed the refund.
	liftRevocation := func(nextAttempt bool) error {
		if !revokedHere {
			return nil
		}
		_, err := queries.LiftStaffRevocation(ctx, dbmodels.LiftStaffRevocationParams{
			TenantID:    tenant.ID,
			ID:          row.ID,
			NextAttempt: nextAttempt,
		})
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return s.internalDBError(ctx, "failed to lift the revocation of a refund that did not happen", err, "tenant_id", tenant.ID.String(), "purchase_id", row.ID.String())
		}
		return nil
	}

	refunded, err := provider.Refund(ctx, credentials, paymentprovider.RefundRequest{
		PaymentID:      row.ProviderPaymentID.String,
		IdempotencyKey: purchaseRefundIdempotencyKey(row.ID, row.StaffRefundAttempt),
	})
	if err != nil {
		refused := errors.Is(err, paymentprovider.ErrRefundRefused)
		// Whether a request that failed some other way reached the provider is
		// unknown, so the purchase stays on this attempt, whose key keeps a
		// retry from refunding twice. A refund it did make is reported by the
		// provider's notification and revokes the purchase again.
		if liftErr := liftRevocation(refused); liftErr != nil {
			return nil, liftErr
		}
		if refused {
			s.logger.WarnContext(ctx, "the payment provider refused a refund",
				"tenant_id", tenant.ID,
				"purchase_id", row.ID,
				"provider", row.Provider.String,
				"error", err,
			)
			return nil, connect.NewError(connect.CodeFailedPrecondition, "the payment provider refused the refund").WithCause(err)
		}
		s.logger.ErrorContext(ctx, "failed to refund a purchase through its payment provider",
			"tenant_id", tenant.ID,
			"purchase_id", row.ID,
			"provider", row.Provider.String,
			"error", err,
		)
		return nil, connect.NewError(connect.CodeUnavailable, "the payment provider did not complete the refund").WithCause(err)
	}

	switch {
	// The payment was refunded in full before staff asked, in the provider's
	// dashboard, and the notification of it has yet to arrive. Staff refunded
	// nothing, so the purchase is left for that notification to revoke.
	case !refunded:
		if err := liftRevocation(false); err != nil {
			return nil, err
		}
		s.logger.InfoContext(ctx, "the payment provider reports a purchase refunded in full already",
			"tenant_id", tenant.ID,
			"purchase_id", row.ID,
			"provider", row.Provider.String,
		)
	default:
		// The refund is recorded by whichever request claims it, not by the
		// one that revoked the purchase: a request finishing what an
		// interrupted one left unasked revoked nothing, and its staff and
		// reason are the only ones the refund has.
		_, err := queries.ClaimStaffRefundRecord(ctx, dbmodels.ClaimStaffRefundRecordParams{
			TenantID: tenant.ID,
			ID:       row.ID,
			Attempt:  row.StaffRefundAttempt,
		})
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, s.internalDBError(ctx, "failed to claim the audit entry of a staff refund", err, "tenant_id", tenant.ID.String(), "purchase_id", row.ID.String())
		}
		if err == nil {
			s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
				TenantID:    tenant.ID,
				ActorUserID: sessionCtx.User.ID,
				ActorRole:   sessionCtx.Role,
				Action:      "purchase_refunded",
				TargetType:  "purchase",
				TargetID:    row.ID.String(),
				Outcome:     auditlog.OutcomeSuccess,
				Reason:      reason,
				ClientIP:    clientip.FromContext(ctx),
			})
		}
	}

	revoked, err := s.loadPurchase(ctx, tenant.ID, row.ID)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.RefundPurchaseResponse{
		Purchase: mapPurchase(revoked, payments),
	}, nil
}
