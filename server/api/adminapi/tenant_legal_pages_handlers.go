package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
)

// tenantLegalPagesRevalidateTags names the tenant read that carries the legal
// pages.
func tenantLegalPagesRevalidateTags(tenantID string) []string {
	return []string{fmt.Sprintf("tenant:%s:site", strings.TrimSpace(tenantID))}
}

func tenantLegalPage(id uuid.NullUUID, slug, title sql.NullString, published bool) *publiraadminv1.TenantLegalPage {
	if !id.Valid {
		return nil
	}
	return &publiraadminv1.TenantLegalPage{
		PageId:    id.UUID.String(),
		Slug:      slug.String,
		Title:     title.String,
		Published: published,
	}
}

func tenantLegalPagesFromRow(row dbmodels.GetTenantLegalPagesRow) *publiraadminv1.TenantLegalPages {
	return &publiraadminv1.TenantLegalPages{
		TermsPage:   tenantLegalPage(row.TermsPageID, row.TermsSlug, row.TermsTitle, row.TermsPublished),
		PrivacyPage: tenantLegalPage(row.PrivacyPageID, row.PrivacySlug, row.PrivacyTitle, row.PrivacyPublished),
	}
}

// readTenantLegalPages answers a tenant with no config row as one that has
// named no page, which is what the columns' NULL says too.
func (s *adminServer) readTenantLegalPages(ctx context.Context, tenantID uuid.UUID) (dbmodels.GetTenantLegalPagesRow, error) {
	row, err := s.queriesFor(ctx).GetTenantLegalPages(ctx, tenantID)
	if errors.Is(err, sql.ErrNoRows) {
		return dbmodels.GetTenantLegalPagesRow{}, nil
	}
	return row, err
}

func (s *adminServer) GetTenantLegalPages(
	ctx context.Context,
	req *connect.Request[publiraadminv1.GetTenantLegalPagesRequest],
) (*connect.Response[publiraadminv1.GetTenantLegalPagesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}

	row, err := s.readTenantLegalPages(ctx, tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get tenant legal pages", err, "tenant_id", tenant.ID.String())
	}
	return connect.NewResponse(&publiraadminv1.GetTenantLegalPagesResponse{Pages: tenantLegalPagesFromRow(row)}), nil
}

// resolveLegalPage turns a requested page id into the value stored for one
// role. The page already named for the role may stay named while it is
// unpublished, so saving the other role does not force the admin to give it
// up.
func (s *adminServer) resolveLegalPage(
	ctx context.Context,
	tenantID uuid.UUID,
	raw string,
	current uuid.NullUUID,
	field string,
) (uuid.NullUUID, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return uuid.NullUUID{}, nil
	}
	pageID, err := uuid.Parse(trimmed)
	if err != nil {
		return uuid.NullUUID{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("page id is invalid"), field)
	}
	page, err := s.queriesFor(ctx).GetPageByIDForTenant(ctx, dbmodels.GetPageByIDForTenantParams{
		ID:       pageID,
		TenantID: tenantID,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return uuid.NullUUID{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("page not found"), field)
		}
		return uuid.NullUUID{}, s.internalDBError(ctx, "failed to get page for tenant legal pages", err, "tenant_id", tenantID.String(), "page_id", pageID.String())
	}
	if !page.PublishedVersionID.Valid && (!current.Valid || current.UUID != page.ID) {
		return uuid.NullUUID{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("page is not published"), field)
	}
	return uuid.NullUUID{UUID: page.ID, Valid: true}, nil
}

func (s *adminServer) UpdateTenantLegalPages(
	ctx context.Context,
	req *connect.Request[publiraadminv1.UpdateTenantLegalPagesRequest],
) (*connect.Response[publiraadminv1.UpdateTenantLegalPagesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}

	current, err := s.readTenantLegalPages(ctx, tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get tenant legal pages", err, "tenant_id", tenant.ID.String())
	}
	termsPageID, err := s.resolveLegalPage(ctx, tenant.ID, req.Msg.GetTermsPageId(), current.TermsPageID, "terms_page_id")
	if err != nil {
		return nil, err
	}
	privacyPageID, err := s.resolveLegalPage(ctx, tenant.ID, req.Msg.GetPrivacyPageId(), current.PrivacyPageID, "privacy_page_id")
	if err != nil {
		return nil, err
	}

	if _, err := s.queriesFor(ctx).UpsertTenantLegalPages(ctx, dbmodels.UpsertTenantLegalPagesParams{
		TenantID:      tenant.ID,
		TermsPageID:   termsPageID,
		PrivacyPageID: privacyPageID,
	}); err != nil {
		return nil, s.internalDBError(ctx, "failed to update tenant legal pages", err, "tenant_id", tenant.ID.String())
	}

	s.revalidateTags(ctx, tenant.ID, tenantLegalPagesRevalidateTags(tenant.ID.String()))

	updated, err := s.readTenantLegalPages(ctx, tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get tenant legal pages", err, "tenant_id", tenant.ID.String())
	}
	return connect.NewResponse(&publiraadminv1.UpdateTenantLegalPagesResponse{Pages: tenantLegalPagesFromRow(updated)}), nil
}
