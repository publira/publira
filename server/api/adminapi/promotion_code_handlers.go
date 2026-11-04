package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/api/protomapper"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/dberr"
	"github.com/publira/publira/server/internal/pagination"
	"github.com/publira/publira/server/internal/paymentsettings"
	"github.com/publira/publira/server/internal/promotioncode"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/revalidate"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

const (
	defaultPromotionCodePageSize = int32(20)
	maxPromotionCodePageSize     = int32(100)

	auditTargetPromotionCode = "promotion_code"
)

var promotionCodeDiscountKinds = map[publiraadminv1.PromotionCodeDiscountKind]string{
	publiraadminv1.PromotionCodeDiscountKind_PROMOTION_CODE_DISCOUNT_KIND_PERCENT: promotioncode.DiscountPercent,
	publiraadminv1.PromotionCodeDiscountKind_PROMOTION_CODE_DISCOUNT_KIND_AMOUNT:  promotioncode.DiscountAmount,
}

var promotionCodeTargetKinds = map[publiraadminv1.PromotionCodeTargetKind]string{
	publiraadminv1.PromotionCodeTargetKind_PROMOTION_CODE_TARGET_KIND_CATALOG: promotioncode.TargetCatalog,
	publiraadminv1.PromotionCodeTargetKind_PROMOTION_CODE_TARGET_KIND_LABEL:   promotioncode.TargetLabel,
	publiraadminv1.PromotionCodeTargetKind_PROMOTION_CODE_TARGET_KIND_SERIES:  promotioncode.TargetSeries,
	publiraadminv1.PromotionCodeTargetKind_PROMOTION_CODE_TARGET_KIND_VOLUME:  promotioncode.TargetVolume,
	publiraadminv1.PromotionCodeTargetKind_PROMOTION_CODE_TARGET_KIND_EPISODE: promotioncode.TargetEpisode,
}

// storedKindToProto answers the enum value a stored kind is named by in kinds,
// or the unspecified value for one this build does not know.
func storedKindToProto[T comparable](kinds map[T]string, stored string) T {
	for value, name := range kinds {
		if name == stored {
			return value
		}
	}
	var unspecified T
	return unspecified
}

// promotionCodeRevalidateTags lists the cached public tenant response, which
// says whether the storefront offers a code input.
func promotionCodeRevalidateTags(tenantID uuid.UUID) []string {
	return tenantPaymentRevalidateTags(tenantID.String())
}

// promotionCodeLimitsInput is a code's limits, read and checked from a
// request.
type promotionCodeLimitsInput struct {
	startsAt                sql.NullTime
	endsAt                  sql.NullTime
	maxRedemptions          sql.NullInt32
	maxRedemptionsPerReader sql.NullInt32
}

func readPromotionCodeLimits(req *publiraadminv1.PromotionCodeLimits) (promotionCodeLimitsInput, error) {
	var in promotionCodeLimitsInput
	if req == nil {
		return in, nil
	}
	readTime := func(raw, field string) (sql.NullTime, error) {
		value := strings.TrimSpace(raw)
		if value == "" {
			return sql.NullTime{}, nil
		}
		at, err := time.Parse(time.RFC3339, value)
		if err != nil {
			return sql.NullTime{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("must be an RFC 3339 instant"), "limits."+field)
		}
		return sql.NullTime{Time: at.UTC(), Valid: true}, nil
	}
	readLimit := func(value int32, field string) (sql.NullInt32, error) {
		if value < 0 {
			return sql.NullInt32{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("must not be negative"), "limits."+field)
		}
		return sql.NullInt32{Int32: value, Valid: value > 0}, nil
	}
	var err error
	if in.startsAt, err = readTime(req.StartsAt, "starts_at"); err != nil {
		return in, err
	}
	if in.endsAt, err = readTime(req.EndsAt, "ends_at"); err != nil {
		return in, err
	}
	if in.startsAt.Valid && in.endsAt.Valid && !in.startsAt.Time.Before(in.endsAt.Time) {
		return in, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("must be after starts_at"), "limits.ends_at")
	}
	if in.maxRedemptions, err = readLimit(req.MaxRedemptions, "max_redemptions"); err != nil {
		return in, err
	}
	if in.maxRedemptionsPerReader, err = readLimit(req.MaxRedemptionsPerReader, "max_redemptions_per_reader"); err != nil {
		return in, err
	}
	return in, nil
}

func (in promotionCodeLimitsInput) equal(row dbmodels.PromotionCode) bool {
	sameTime := func(a, b sql.NullTime) bool {
		return a.Valid == b.Valid && (!a.Valid || a.Time.Equal(b.Time))
	}
	return sameTime(in.startsAt, row.StartsAt) &&
		sameTime(in.endsAt, row.EndsAt) &&
		in.maxRedemptions == row.MaxRedemptions &&
		in.maxRedemptionsPerReader == row.MaxRedemptionsPerReader
}

func nullInt32Value(value sql.NullInt32) int32 {
	if !value.Valid {
		return 0
	}
	return value.Int32
}

func promotionCodeToProto(row dbmodels.ListPromotionCodesByIDsRow, currency string) *publiraadminv1.PromotionCode {
	return &publiraadminv1.PromotionCode{
		Id:            row.ID.String(),
		Code:          row.Code,
		DiscountKind:  storedKindToProto(promotionCodeDiscountKinds, row.DiscountKind),
		DiscountValue: row.DiscountValue,
		Currency:      currency,
		TargetKind:    storedKindToProto(promotionCodeTargetKinds, row.TargetKind),
		TargetId:      nullUUIDString(row.TargetID),
		TargetTitle:   row.TargetTitle,
		Limits: &publiraadminv1.PromotionCodeLimits{
			StartsAt:                formatOptionalTime(row.StartsAt),
			EndsAt:                  formatOptionalTime(row.EndsAt),
			MaxRedemptions:          nullInt32Value(row.MaxRedemptions),
			MaxRedemptionsPerReader: nullInt32Value(row.MaxRedemptionsPerReader),
		},
		PausedAt:        formatOptionalTime(row.PausedAt),
		RedemptionCount: row.RedemptionCount,
		CreatedAt:       row.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:       row.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

// promotionCodes reads the codes ids names, in that order, as the console
// shows them. A code deleted since its id was read is left out.
func (s *adminServer) promotionCodes(ctx context.Context, tenantID uuid.UUID, ids []uuid.UUID) ([]*publiraadminv1.PromotionCode, error) {
	if len(ids) == 0 {
		return []*publiraadminv1.PromotionCode{}, nil
	}
	rows, err := s.queriesFor(ctx).ListPromotionCodesByIDs(ctx, dbmodels.ListPromotionCodesByIDsParams{TenantID: tenantID, Ids: ids})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to read promotion codes", err, "tenant_id", tenantID.String())
	}
	currency, err := s.tenantCurrency(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	byID := make(map[uuid.UUID]dbmodels.ListPromotionCodesByIDsRow, len(rows))
	for _, row := range rows {
		byID[row.ID] = row
	}
	codes := make([]*publiraadminv1.PromotionCode, 0, len(ids))
	for _, id := range ids {
		if row, ok := byID[id]; ok {
			codes = append(codes, promotionCodeToProto(row, currency))
		}
	}
	return codes, nil
}

// promotionCode reads one code the tenant has not deleted, or answers
// not_found.
func (s *adminServer) promotionCode(ctx context.Context, tenantID, id uuid.UUID) (*publiraadminv1.PromotionCode, error) {
	codes, err := s.promotionCodes(ctx, tenantID, []uuid.UUID{id})
	if err != nil {
		return nil, err
	}
	if len(codes) == 0 {
		return nil, connect.NewError(connect.CodeNotFound, "promotion code not found")
	}
	return codes[0], nil
}

// lockPromotionCode locks the code a request names, which has to be one the
// tenant has not deleted.
func (s *adminServer) lockPromotionCode(txCtx context.Context, tenantID, id uuid.UUID) (dbmodels.PromotionCode, error) {
	row, err := s.queriesFor(txCtx).LockPromotionCodeForTenant(txCtx, dbmodels.LockPromotionCodeForTenantParams{TenantID: tenantID, ID: id})
	if errors.Is(err, sql.ErrNoRows) {
		return dbmodels.PromotionCode{}, connect.NewError(connect.CodeNotFound, "promotion code not found")
	}
	if err != nil {
		return dbmodels.PromotionCode{}, s.internalDBError(txCtx, "failed to lock promotion code", err, "tenant_id", tenantID.String(), "promotion_code_id", id.String())
	}
	return row, nil
}

func (s *adminServer) ListPromotionCodes(
	ctx context.Context,
	req *publiraadminv1.ListPromotionCodesRequest,
) (*publiraadminv1.ListPromotionCodesResponse, error) {
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	limit := pagination.NormalizeLimit(req.Limit, defaultPromotionCodePageSize, maxPromotionCodePageSize)
	cursor, keys, err := decodeTimeUUIDToken(req.Token)
	if err != nil {
		return nil, err
	}

	type key struct {
		id        uuid.UUID
		createdAt time.Time
	}
	var rows []key
	queries := s.queriesFor(ctx)
	params := dbmodels.ListPromotionCodeIDsDescParams{
		TenantID:        tenant.ID,
		CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
		CursorInclusive: keys.Inclusive,
		CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
		Limit:           limit + 1,
	}
	if cursor.Direction == pagination.Backward {
		found, err := queries.ListPromotionCodeIDsAsc(ctx, dbmodels.ListPromotionCodeIDsAscParams(params))
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to list promotion codes", err, "tenant_id", tenant.ID.String())
		}
		for _, row := range found {
			rows = append(rows, key{id: row.ID, createdAt: row.CreatedAt})
		}
	} else {
		found, err := queries.ListPromotionCodeIDsDesc(ctx, params)
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to list promotion codes", err, "tenant_id", tenant.ID.String())
		}
		for _, row := range found {
			rows = append(rows, key{id: row.ID, createdAt: row.CreatedAt})
		}
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)
	ids := make([]uuid.UUID, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.id)
	}
	codes, err := s.promotionCodes(ctx, tenant.ID, ids)
	if err != nil {
		return nil, err
	}

	res := &publiraadminv1.ListPromotionCodesResponse{PromotionCodes: codes}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = pagination.EncodeTimeUUID(pagination.Backward, rows[0].createdAt, rows[0].id)
		}
		if hasNext {
			last := rows[len(rows)-1]
			res.NextToken = pagination.EncodeTimeUUID(pagination.Forward, last.createdAt, last.id)
		}
	case cursor.Direction == pagination.Forward && !keys.Inclusive && keys.Valid:
		res.PreviousToken = pagination.EncodeTimeUUIDRecovery(pagination.Backward, keys.Time, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive && keys.Valid:
		res.NextToken = pagination.EncodeTimeUUIDRecovery(pagination.Forward, keys.Time, keys.ID)
	}
	return res, nil
}

func (s *adminServer) GetPromotionCode(
	ctx context.Context,
	req *publiraadminv1.GetPromotionCodeRequest,
) (*publiraadminv1.GetPromotionCodeResponse, error) {
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	id, err := parseRecordID(req.PromotionCodeId, "promotion_code_id")
	if err != nil {
		return nil, err
	}
	code, err := s.promotionCode(ctx, tenant.ID, id)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.GetPromotionCodeResponse{PromotionCode: code}, nil
}

func (s *adminServer) CreatePromotionCode(
	ctx context.Context,
	req *publiraadminv1.CreatePromotionCodeRequest,
) (*publiraadminv1.CreatePromotionCodeResponse, error) {
	session, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	code := strings.TrimSpace(req.Code)
	if !promotioncode.ValidCode(code) {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("must be 1 to 32 ASCII letters and digits"), "code")
	}
	discountKind, ok := promotionCodeDiscountKinds[req.DiscountKind]
	if !ok {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("discount_kind is required"), "discount_kind")
	}
	switch {
	case discountKind == promotioncode.DiscountPercent && (req.DiscountValue < 1 || req.DiscountValue > 100):
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("a percentage must be 1 to 100"), "discount_value")
	case discountKind == promotioncode.DiscountAmount && req.DiscountValue < 1:
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("an amount must be at least 1"), "discount_value")
	}
	targetKind, ok := promotionCodeTargetKinds[req.TargetKind]
	if !ok {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("target_kind is required"), "target_kind")
	}
	var targetID uuid.NullUUID
	if targetKind != promotioncode.TargetCatalog {
		id, err := parseRecordID(req.TargetId, "target_id")
		if err != nil {
			return nil, err
		}
		targetID = uuid.NullUUID{UUID: id, Valid: true}
	}
	limits, err := readPromotionCodeLimits(req.Limits)
	if err != nil {
		return nil, err
	}
	id, err := uuid.NewV7()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err.Error()).WithCause(err)
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin create promotion code transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txCtx := rpcmiddleware.WithTenantQueries(ctx, dbmodels.New(tx))
	queries := s.queriesFor(txCtx)

	// An amount is in the currency the client entered it in, which has to be
	// the tenant's, as an episode's price is checked.
	if discountKind == promotioncode.DiscountAmount {
		err := paymentsettings.CheckPriceCurrency(txCtx, queries, tenant.ID, req.Currency)
		if errors.Is(err, paymentsettings.ErrPriceCurrencyChanged) {
			return nil, rpcerrors.NewFieldViolationError(connect.CodeFailedPrecondition, err, "currency")
		}
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to check the currency of a promotion code", err, "tenant_id", tenant.ID.String())
		}
	}
	exists, err := queries.PromotionCodeTargetExists(txCtx, dbmodels.PromotionCodeTargetExistsParams{
		TargetKind: targetKind,
		TenantID:   tenant.ID,
		TargetID:   targetID,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to check a promotion code's target", err, "tenant_id", tenant.ID.String())
	}
	if !exists {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("names nothing of the tenant's"), "target_id")
	}
	if _, err := queries.CreatePromotionCode(txCtx, dbmodels.CreatePromotionCodeParams{
		ID:                      id,
		TenantID:                tenant.ID,
		Code:                    code,
		DiscountKind:            discountKind,
		DiscountValue:           req.DiscountValue,
		TargetKind:              targetKind,
		TargetID:                targetID,
		StartsAt:                limits.startsAt,
		EndsAt:                  limits.endsAt,
		MaxRedemptions:          limits.maxRedemptions,
		MaxRedemptionsPerReader: limits.maxRedemptionsPerReader,
		CreatedByUserID:         uuid.NullUUID{UUID: session.User.ID, Valid: true},
	}); err != nil {
		if dberr.IsUniqueViolation(err) {
			return nil, connect.NewError(connect.CodeAlreadyExists, "a promotion code is already spelled so")
		}
		return nil, s.internalDBError(ctx, "failed to create promotion code", err, "tenant_id", tenant.ID.String())
	}
	if err := s.writeTenantSettingAuditOn(txCtx, tenant, session, "promotion_code_created", auditTargetPromotionCode, id.String()); err != nil {
		return nil, err
	}
	owed, err := s.reval.Record(txCtx, queries, tenant.ID, promotionCodeRevalidateTags(tenant.ID))
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to record the cache invalidation for a promotion code create", err, "tenant_id", tenant.ID.String())
	}
	created, err := s.promotionCode(txCtx, tenant.ID, id)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit create promotion code", err, "tenant_id", tenant.ID.String())
	}
	s.reval.Send(ctx, owed)
	return &publiraadminv1.CreatePromotionCodeResponse{PromotionCode: created}, nil
}

// changePromotionCode runs change on the code a request names under its lock,
// and answers the code as it stands once the change is committed. change
// reports the audit action of what it changed, or "" for a request that
// changed nothing, which records nothing.
func (s *adminServer) changePromotionCode(
	ctx context.Context,
	session rpcmiddleware.SessionContext,
	tenantContext *publirattypesv1.TenantContext,
	rawID string,
	change func(txCtx context.Context, queries *dbmodels.Queries, current dbmodels.PromotionCode) (string, error),
) (*publiraadminv1.PromotionCode, error) {
	tenant, err := s.tenantByContext(ctx, tenantContext)
	if err != nil {
		return nil, err
	}
	id, err := parseRecordID(rawID, "promotion_code_id")
	if err != nil {
		return nil, err
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin promotion code transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	queries := dbmodels.New(tx)
	txCtx := rpcmiddleware.WithTenantQueries(ctx, queries)

	current, err := s.lockPromotionCode(txCtx, tenant.ID, id)
	if err != nil {
		return nil, err
	}
	action, err := change(txCtx, queries, current)
	if err != nil {
		return nil, err
	}
	var owed revalidate.Owed
	if action != "" {
		if err := s.writeTenantSettingAuditOn(txCtx, tenant, session, action, auditTargetPromotionCode, id.String()); err != nil {
			return nil, err
		}
		if owed, err = s.reval.Record(txCtx, queries, tenant.ID, promotionCodeRevalidateTags(tenant.ID)); err != nil {
			return nil, s.internalDBError(ctx, "failed to record the cache invalidation for a promotion code change", err, "tenant_id", tenant.ID.String(), "promotion_code_id", id.String())
		}
	}
	var answer *publiraadminv1.PromotionCode
	if action != "promotion_code_deleted" {
		if answer, err = s.promotionCode(txCtx, tenant.ID, id); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit promotion code change", err, "tenant_id", tenant.ID.String(), "promotion_code_id", id.String())
	}
	s.reval.Send(ctx, owed)
	return answer, nil
}

func (s *adminServer) UpdatePromotionCode(
	ctx context.Context,
	req *publiraadminv1.UpdatePromotionCodeRequest,
) (*publiraadminv1.UpdatePromotionCodeResponse, error) {
	session, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	limits, err := readPromotionCodeLimits(req.Limits)
	if err != nil {
		return nil, err
	}
	code, err := s.changePromotionCode(ctx, session, req.Tenant, req.PromotionCodeId, func(txCtx context.Context, queries *dbmodels.Queries, current dbmodels.PromotionCode) (string, error) {
		if limits.equal(current) {
			return "", nil
		}
		if err := queries.UpdatePromotionCodeLimits(txCtx, dbmodels.UpdatePromotionCodeLimitsParams{
			TenantID:                current.TenantID,
			ID:                      current.ID,
			StartsAt:                limits.startsAt,
			EndsAt:                  limits.endsAt,
			MaxRedemptions:          limits.maxRedemptions,
			MaxRedemptionsPerReader: limits.maxRedemptionsPerReader,
		}); err != nil {
			return "", s.internalDBError(txCtx, "failed to update promotion code", err, "tenant_id", current.TenantID.String(), "promotion_code_id", current.ID.String())
		}
		return "promotion_code_updated", nil
	})
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.UpdatePromotionCodeResponse{PromotionCode: code}, nil
}

// setPromotionCodePaused pauses or resumes the code a request names, and
// changes nothing for one already so.
func (s *adminServer) setPromotionCodePaused(ctx context.Context, session rpcmiddleware.SessionContext, tenantContext *publirattypesv1.TenantContext, rawID string, paused bool) (*publiraadminv1.PromotionCode, error) {
	action := "promotion_code_resumed"
	if paused {
		action = "promotion_code_paused"
	}
	return s.changePromotionCode(ctx, session, tenantContext, rawID, func(txCtx context.Context, queries *dbmodels.Queries, current dbmodels.PromotionCode) (string, error) {
		if current.PausedAt.Valid == paused {
			return "", nil
		}
		if err := queries.SetPromotionCodePaused(txCtx, dbmodels.SetPromotionCodePausedParams{
			TenantID: current.TenantID,
			ID:       current.ID,
			Paused:   paused,
		}); err != nil {
			return "", s.internalDBError(txCtx, "failed to pause or resume promotion code", err, "tenant_id", current.TenantID.String(), "promotion_code_id", current.ID.String())
		}
		return action, nil
	})
}

func (s *adminServer) PausePromotionCode(
	ctx context.Context,
	req *publiraadminv1.PausePromotionCodeRequest,
) (*publiraadminv1.PausePromotionCodeResponse, error) {
	session, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	code, err := s.setPromotionCodePaused(ctx, session, req.Tenant, req.PromotionCodeId, true)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.PausePromotionCodeResponse{PromotionCode: code}, nil
}

func (s *adminServer) ResumePromotionCode(
	ctx context.Context,
	req *publiraadminv1.ResumePromotionCodeRequest,
) (*publiraadminv1.ResumePromotionCodeResponse, error) {
	session, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	code, err := s.setPromotionCodePaused(ctx, session, req.Tenant, req.PromotionCodeId, false)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.ResumePromotionCodeResponse{PromotionCode: code}, nil
}

func (s *adminServer) DeletePromotionCode(
	ctx context.Context,
	req *publiraadminv1.DeletePromotionCodeRequest,
) (*publiraadminv1.DeletePromotionCodeResponse, error) {
	session, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := s.changePromotionCode(ctx, session, req.Tenant, req.PromotionCodeId, func(txCtx context.Context, queries *dbmodels.Queries, current dbmodels.PromotionCode) (string, error) {
		if err := queries.DeletePromotionCode(txCtx, dbmodels.DeletePromotionCodeParams{TenantID: current.TenantID, ID: current.ID}); err != nil {
			return "", s.internalDBError(txCtx, "failed to delete promotion code", err, "tenant_id", current.TenantID.String(), "promotion_code_id", current.ID.String())
		}
		return "promotion_code_deleted", nil
	}); err != nil {
		return nil, err
	}
	return &publiraadminv1.DeletePromotionCodeResponse{}, nil
}

func (s *adminServer) ListPromotionCodeRedemptions(
	ctx context.Context,
	req *publiraadminv1.ListPromotionCodeRedemptionsRequest,
) (*publiraadminv1.ListPromotionCodeRedemptionsResponse, error) {
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	codeID, err := parseRecordID(req.PromotionCodeId, "promotion_code_id")
	if err != nil {
		return nil, err
	}
	limit := pagination.NormalizeLimit(req.Limit, defaultPromotionCodePageSize, maxPromotionCodePageSize)
	cursor, keys, err := decodeTimeUUIDToken(req.Token)
	if err != nil {
		return nil, err
	}
	if _, err := s.promotionCode(ctx, tenant.ID, codeID); err != nil {
		return nil, err
	}

	queries := s.queriesFor(ctx)
	params := dbmodels.ListPromotionCodeRedemptionsDescParams{
		TenantID:         tenant.ID,
		PromotionCodeID:  codeID,
		CursorRedeemedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
		CursorInclusive:  keys.Inclusive,
		CursorID:         uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
		Limit:            limit + 1,
	}
	var rows []dbmodels.ListPromotionCodeRedemptionsDescRow
	if cursor.Direction == pagination.Backward {
		found, err := queries.ListPromotionCodeRedemptionsAsc(ctx, dbmodels.ListPromotionCodeRedemptionsAscParams(params))
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to list promotion code redemptions", err, "tenant_id", tenant.ID.String())
		}
		for _, row := range found {
			rows = append(rows, dbmodels.ListPromotionCodeRedemptionsDescRow(row))
		}
	} else {
		if rows, err = queries.ListPromotionCodeRedemptionsDesc(ctx, params); err != nil {
			return nil, s.internalDBError(ctx, "failed to list promotion code redemptions", err, "tenant_id", tenant.ID.String())
		}
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)
	redemptions := make([]*publiraadminv1.PromotionCodeRedemption, 0, len(rows))
	for _, row := range rows {
		kind, err := protomapper.PurchaseKindFromStored(row.Kind)
		if err != nil {
			return nil, s.internalError(ctx, "purchase holds a kind this build does not know", err, "tenant_id", tenant.ID.String(), "purchase_id", row.PurchaseID.String())
		}
		redemptions = append(redemptions, &publiraadminv1.PromotionCodeRedemption{
			Id:             row.ID.String(),
			RedeemedAt:     row.RedeemedAt.UTC().Format(time.RFC3339),
			ReaderPublicId: formatOptionalString(row.UserPublicID),
			ReaderEmail:    formatOptionalString(row.UserEmail),
			PurchaseId:     row.PurchaseID.String(),
			EpisodeId:      nullUUIDString(row.EpisodeID),
			VolumeId:       nullUUIDString(row.VolumeID),
			Title:          row.ItemTitle,
			Kind:           kind,
			ListPrice:      row.ListPrice,
			Price:          row.PriceAtPurchase,
			Currency:       row.Currency,
		})
	}

	res := &publiraadminv1.ListPromotionCodeRedemptionsResponse{Redemptions: redemptions}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = pagination.EncodeTimeUUID(pagination.Backward, rows[0].RedeemedAt, rows[0].ID)
		}
		if hasNext {
			last := rows[len(rows)-1]
			res.NextToken = pagination.EncodeTimeUUID(pagination.Forward, last.RedeemedAt, last.ID)
		}
	case cursor.Direction == pagination.Forward && !keys.Inclusive && keys.Valid:
		res.PreviousToken = pagination.EncodeTimeUUIDRecovery(pagination.Backward, keys.Time, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive && keys.Valid:
		res.NextToken = pagination.EncodeTimeUUIDRecovery(pagination.Forward, keys.Time, keys.ID)
	}
	return res, nil
}
