package adminapi

import (
	"context"

	"connectrpc.com/connect/v2"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/siteverification"
)

func tenantSiteVerificationToProto(codes siteverification.Codes) *publiraadminv1.TenantSiteVerification {
	return &publiraadminv1.TenantSiteVerification{
		GoogleSiteVerification: codes.Google,
		BingSiteVerification:   codes.Bing,
	}
}

// normalizeTenantSiteVerification validates a requested save and answers it
// ready to store.
func normalizeTenantSiteVerification(requested *publiraadminv1.TenantSiteVerification) (siteverification.Codes, error) {
	google, err := siteverification.NormalizeCode(requested.GetGoogleSiteVerification())
	if err != nil {
		return siteverification.Codes{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "site_verification.google_site_verification")
	}
	bing, err := siteverification.NormalizeCode(requested.GetBingSiteVerification())
	if err != nil {
		return siteverification.Codes{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "site_verification.bing_site_verification")
	}
	return siteverification.Codes{Google: google, Bing: bing}, nil
}

func (s *adminServer) GetTenantSiteVerification(
	ctx context.Context,
	req *publiraadminv1.GetTenantSiteVerificationRequest,
) (*publiraadminv1.GetTenantSiteVerificationResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}
	codes, err := siteverification.Get(ctx, s.queriesFor(ctx), tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get tenant site verification", err, "tenant_id", tenant.ID.String())
	}
	return &publiraadminv1.GetTenantSiteVerificationResponse{SiteVerification: tenantSiteVerificationToProto(codes)}, nil
}

func (s *adminServer) UpdateTenantSiteVerification(
	ctx context.Context,
	req *publiraadminv1.UpdateTenantSiteVerificationRequest,
) (*publiraadminv1.UpdateTenantSiteVerificationResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	session, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	if req.SiteVerification == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, "site_verification is required")
	}
	next, err := normalizeTenantSiteVerification(req.SiteVerification)
	if err != nil {
		return nil, err
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin tenant site verification transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	qtx := dbmodels.New(tx)
	txCtx := rpcmiddleware.WithTenantQueries(ctx, qtx)

	if _, err := qtx.LockTenantForSiteVerification(txCtx, tenant.ID); err != nil {
		return nil, s.internalDBError(ctx, "failed to lock tenant site verification", err, "tenant_id", tenant.ID.String())
	}
	current, err := siteverification.Get(txCtx, qtx, tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get tenant site verification", err, "tenant_id", tenant.ID.String())
	}
	if next == current {
		return &publiraadminv1.UpdateTenantSiteVerificationResponse{SiteVerification: tenantSiteVerificationToProto(current)}, nil
	}

	row, err := qtx.UpsertTenantSiteVerification(ctx, dbmodels.UpsertTenantSiteVerificationParams{
		TenantID:               tenant.ID,
		GoogleSiteVerification: nullableString(next.Google),
		BingSiteVerification:   nullableString(next.Bing),
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to update tenant site verification", err, "tenant_id", tenant.ID.String())
	}
	if err := s.writeTenantSettingAudit(txCtx, tenant, session, siteverification.ActionUpdated, siteverification.AuditTargetType); err != nil {
		return nil, err
	}
	// The storefront reads the codes with the Google tag, from
	// TenantService.GetTenantAnalyticsSettings, so the same entry is dropped.
	owed, err := s.reval.Record(ctx, qtx, tenant.ID, tenantAnalyticsSettingsRevalidateTags(tenant.ID.String()))
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to record the cache invalidation for the tenant site verification", err, "tenant_id", tenant.ID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit tenant site verification", err, "tenant_id", tenant.ID.String())
	}
	s.reval.Send(ctx, owed)

	return &publiraadminv1.UpdateTenantSiteVerificationResponse{SiteVerification: tenantSiteVerificationToProto(siteverification.FromRow(row))}, nil
}
