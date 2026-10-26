package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"math"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/paymentsettings"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/publicid"
	"github.com/publira/publira/server/internal/revalidate"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

// maxCoinPacks bounds how many packs one tenant sells at once, which is what
// lets every list of them go unpaged. A retired pack no longer counts.
const maxCoinPacks = 20

var (
	errCoinPackLimit = errors.New("the tenant holds as many coin packs as it may")
	errCoinPackSold  = errors.New("a coin pack that has been sold keeps its price and coins")
)

// coinPackInput is a pack's fields, read and checked from a request.
type coinPackInput struct {
	coins      int32
	bonusCoins int32
	price      int32
	sortOrder  int32
	onSale     bool
}

func readCoinPackInput(req *publiraadminv1.CoinPackInput) (coinPackInput, error) {
	if req == nil {
		return coinPackInput{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("pack is required"), "pack")
	}
	if req.Coins < 1 {
		return coinPackInput{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("coins must be at least 1"), "pack.coins")
	}
	// A purchase grants the two together, so their sum has to be a count of
	// coins too.
	if req.BonusCoins < 0 || req.BonusCoins > math.MaxInt32-req.Coins {
		return coinPackInput{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("bonus_coins must not be negative, and coins and bonus_coins together must fit in an int32"), "pack.bonus_coins")
	}
	if req.Price < 1 {
		return coinPackInput{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("price must be at least 1"), "pack.price")
	}
	return coinPackInput{
		coins:      req.Coins,
		bonusCoins: req.BonusCoins,
		price:      req.Price,
		sortOrder:  req.SortOrder,
		onSale:     req.OnSale,
	}, nil
}

func coinPackToProto(row dbmodels.TenantCoinPack, currency string) *publiraadminv1.CoinPack {
	return &publiraadminv1.CoinPack{
		Id:         row.ID.String(),
		PublicId:   row.PublicID,
		Coins:      row.Coins,
		BonusCoins: row.BonusCoins,
		Price:      row.Price,
		Currency:   currency,
		SortOrder:  row.SortOrder,
		OnSale:     row.OnSale,
		Sold:       row.FirstSoldAt.Valid,
		CreatedAt:  row.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:  row.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

// lockCoinPack locks the pack a request names, which has to be one the tenant
// has not retired.
func (s *adminServer) lockCoinPack(txCtx context.Context, tenantID, id uuid.UUID) (dbmodels.TenantCoinPack, error) {
	row, err := s.queriesFor(txCtx).LockCoinPackForTenant(txCtx, dbmodels.LockCoinPackForTenantParams{TenantID: tenantID, ID: id})
	if errors.Is(err, sql.ErrNoRows) {
		return dbmodels.TenantCoinPack{}, connect.NewError(connect.CodeNotFound, "coin pack not found")
	}
	if err != nil {
		return dbmodels.TenantCoinPack{}, s.internalDBError(txCtx, "failed to lock coin pack", err, "tenant_id", tenantID.String(), "coin_pack_id", id.String())
	}
	return row, nil
}

// tenantCurrency answers the currency the tenant's pack prices are in.
func (s *adminServer) tenantCurrency(ctx context.Context, tenantID uuid.UUID) (string, error) {
	currency, err := paymentsettings.TenantCurrency(ctx, s.queriesFor(ctx), tenantID)
	if err != nil {
		return "", s.internalDBError(ctx, "failed to read the tenant currency", err, "tenant_id", tenantID.String())
	}
	return currency, nil
}

func (s *adminServer) ListCoinPacks(
	ctx context.Context,
	req *publiraadminv1.ListCoinPacksRequest,
) (*publiraadminv1.ListCoinPacksResponse, error) {
	if _, err := s.requireTenantAuditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	rows, err := s.queriesFor(ctx).ListCoinPacksForTenant(ctx, tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list coin packs", err, "tenant_id", tenant.ID.String())
	}
	currency, err := s.tenantCurrency(ctx, tenant.ID)
	if err != nil {
		return nil, err
	}
	packs := make([]*publiraadminv1.CoinPack, 0, len(rows))
	for _, row := range rows {
		packs = append(packs, coinPackToProto(row, currency))
	}
	return &publiraadminv1.ListCoinPacksResponse{Packs: packs}, nil
}

func (s *adminServer) CreateCoinPack(
	ctx context.Context,
	req *publiraadminv1.CreateCoinPackRequest,
) (*publiraadminv1.CreateCoinPackResponse, error) {
	session, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	input, err := readCoinPackInput(req.Pack)
	if err != nil {
		return nil, err
	}
	packID, err := uuid.NewV7()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err.Error()).WithCause(err)
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin create coin pack transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txCtx := rpcmiddleware.WithTenantQueries(ctx, dbmodels.New(tx))
	queries := s.queriesFor(txCtx)

	if err := s.checkCoinAmountCurrency(txCtx, queries, tenant.ID, input.price, req.Pack.GetCurrency(), "pack.currency"); err != nil {
		return nil, err
	}
	if _, err := queries.LockTenantForCoinPacks(txCtx, tenant.ID); err != nil {
		return nil, s.internalDBError(ctx, "failed to lock the tenant for a coin pack create", err, "tenant_id", tenant.ID.String())
	}
	count, err := queries.CountCoinPacksForTenant(txCtx, tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to count coin packs", err, "tenant_id", tenant.ID.String())
	}
	if count >= maxCoinPacks {
		return nil, rpcerrors.NewErrorInfoError(connect.CodeFailedPrecondition, errCoinPackLimit, rpcerrors.ReasonCoinPackLimit)
	}
	created, err := publicid.InsertTx(txCtx, tx, func(publicID string) (dbmodels.TenantCoinPack, error) {
		return queries.CreateCoinPack(txCtx, dbmodels.CreateCoinPackParams{
			ID:         packID,
			TenantID:   tenant.ID,
			PublicID:   publicID,
			Coins:      input.coins,
			BonusCoins: input.bonusCoins,
			Price:      input.price,
			SortOrder:  input.sortOrder,
			OnSale:     input.onSale,
		})
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to create coin pack", err, "tenant_id", tenant.ID.String())
	}
	if err := s.writeTenantSettingAuditOn(txCtx, tenant, session, "coin_pack_created", "coin_pack", created.PublicID); err != nil {
		return nil, err
	}
	owed, err := s.reval.Record(txCtx, queries, tenant.ID, coinSettingsRevalidateTags(tenant.ID))
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to record the cache invalidation for a coin pack create", err, "tenant_id", tenant.ID.String())
	}
	currency, err := s.tenantCurrency(txCtx, tenant.ID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit create coin pack", err, "tenant_id", tenant.ID.String())
	}
	s.reval.Send(ctx, owed)
	return &publiraadminv1.CreateCoinPackResponse{Pack: coinPackToProto(created, currency)}, nil
}

func (s *adminServer) UpdateCoinPack(
	ctx context.Context,
	req *publiraadminv1.UpdateCoinPackRequest,
) (*publiraadminv1.UpdateCoinPackResponse, error) {
	session, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	id, err := parseRecordID(req.CoinPackId, "coin_pack_id")
	if err != nil {
		return nil, err
	}
	input, err := readCoinPackInput(req.Pack)
	if err != nil {
		return nil, err
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin update coin pack transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txCtx := rpcmiddleware.WithTenantQueries(ctx, dbmodels.New(tx))
	queries := s.queriesFor(txCtx)

	current, err := s.lockCoinPack(txCtx, tenant.ID, id)
	if err != nil {
		return nil, err
	}
	termsChanged := input.coins != current.Coins || input.bonusCoins != current.BonusCoins || input.price != current.Price
	if termsChanged && current.FirstSoldAt.Valid {
		return nil, rpcerrors.NewErrorInfoError(connect.CodeFailedPrecondition, errCoinPackSold, rpcerrors.ReasonCoinPackSold)
	}
	// The price is checked against the currency only when it changes: a price
	// left as it was is not one the client entered.
	if input.price != current.Price {
		if err := s.checkCoinAmountCurrency(txCtx, queries, tenant.ID, input.price, req.Pack.GetCurrency(), "pack.currency"); err != nil {
			return nil, err
		}
	}
	updated := current
	var owed revalidate.Owed
	if termsChanged || input.sortOrder != current.SortOrder || input.onSale != current.OnSale {
		updated, err = queries.UpdateCoinPack(txCtx, dbmodels.UpdateCoinPackParams{
			TenantID:   tenant.ID,
			ID:         current.ID,
			Coins:      input.coins,
			BonusCoins: input.bonusCoins,
			Price:      input.price,
			SortOrder:  input.sortOrder,
			OnSale:     input.onSale,
		})
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to update coin pack", err, "tenant_id", tenant.ID.String(), "coin_pack_id", current.ID.String())
		}
		if err := s.writeTenantSettingAuditOn(txCtx, tenant, session, "coin_pack_updated", "coin_pack", current.PublicID); err != nil {
			return nil, err
		}
		if owed, err = s.reval.Record(txCtx, queries, tenant.ID, coinSettingsRevalidateTags(tenant.ID)); err != nil {
			return nil, s.internalDBError(ctx, "failed to record the cache invalidation for a coin pack update", err, "tenant_id", tenant.ID.String(), "coin_pack_id", current.ID.String())
		}
	}
	currency, err := s.tenantCurrency(txCtx, tenant.ID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit update coin pack", err, "tenant_id", tenant.ID.String())
	}
	s.reval.Send(ctx, owed)
	return &publiraadminv1.UpdateCoinPackResponse{Pack: coinPackToProto(updated, currency)}, nil
}

func (s *adminServer) RetireCoinPack(
	ctx context.Context,
	req *publiraadminv1.RetireCoinPackRequest,
) (*publiraadminv1.RetireCoinPackResponse, error) {
	session, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	id, err := parseRecordID(req.CoinPackId, "coin_pack_id")
	if err != nil {
		return nil, err
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin retire coin pack transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txCtx := rpcmiddleware.WithTenantQueries(ctx, dbmodels.New(tx))
	queries := s.queriesFor(txCtx)

	current, err := s.lockCoinPack(txCtx, tenant.ID, id)
	if err != nil {
		return nil, err
	}
	if err := queries.RetireCoinPack(txCtx, dbmodels.RetireCoinPackParams{TenantID: tenant.ID, ID: current.ID}); err != nil {
		return nil, s.internalDBError(ctx, "failed to retire coin pack", err, "tenant_id", tenant.ID.String(), "coin_pack_id", current.ID.String())
	}
	if err := s.writeTenantSettingAuditOn(txCtx, tenant, session, "coin_pack_retired", "coin_pack", current.PublicID); err != nil {
		return nil, err
	}
	owed, err := s.reval.Record(txCtx, queries, tenant.ID, coinSettingsRevalidateTags(tenant.ID))
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to record the cache invalidation for a coin pack retire", err, "tenant_id", tenant.ID.String(), "coin_pack_id", current.ID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit retire coin pack", err, "tenant_id", tenant.ID.String())
	}
	s.reval.Send(ctx, owed)
	return &publiraadminv1.RetireCoinPackResponse{}, nil
}
