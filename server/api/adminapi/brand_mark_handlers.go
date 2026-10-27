package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"strings"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/api/protomapper"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/imageproc"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
)

// maxBrandMarkTermsURLLength bounds the guideline URL a mark is recorded as
// accepted under. The console sends one of its own constants, so the bound is
// there for a caller that sends anything else.
const maxBrandMarkTermsURLLength = 2048

var errBrandMarkTermsNotAccepted = errors.New("the terms of the mark's owner have not been accepted")

// tenantBrandMarkImages files the marks' images apart from the theme's.
var tenantBrandMarkImages = tenantBrandingImagesIn("brand-marks")

// brandMarkRevalidateTags drops the storefront's read of the tenant, which
// carries the marks.
func brandMarkRevalidateTags(tenantID uuid.UUID) []string {
	return []string{fmt.Sprintf("tenant:%s:site", tenantID.String())}
}

func (s *adminServer) ListTenantBrandMarks(
	ctx context.Context,
	req *publiraadminv1.ListTenantBrandMarksRequest,
) (*publiraadminv1.ListTenantBrandMarksResponse, error) {
	if _, err := s.requireTenantAuditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}

	marks, err := s.tenantBrandMarks(ctx, tenant.ID)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.ListTenantBrandMarksResponse{BrandMarks: marks}, nil
}

// UploadTenantBrandMark stores the image as the tenant's mark of its kind
// together with the consent it was uploaded under, replacing the image and
// the consent of a mark already there. Nothing is stored unless the request
// says the terms were accepted.
func (s *adminServer) UploadTenantBrandMark(
	ctx context.Context,
	req *publiraadminv1.UploadTenantBrandMarkRequest,
) (*publiraadminv1.UploadTenantBrandMarkResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	session, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}

	kind, err := protomapper.TenantBrandMarkKindToStored(req.Kind)
	if err != nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "kind")
	}
	termsURL, err := validateBrandMarkTermsURL(req.TermsUrl)
	if err != nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "terms_url")
	}
	if !req.TermsAccepted {
		return nil, rpcerrors.NewErrorInfoError(connect.CodeFailedPrecondition, errBrandMarkTermsNotAccepted, rpcerrors.ReasonBrandMarkTermsNotAccepted)
	}
	variant, err := imageproc.BuildBrandMark(req.ImageData, req.ImageContentType, kind)
	if err != nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "image_data")
	}

	var stored *publiraadminv1.AdminTenantBrandMark
	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		queries := s.queriesFor(txCtx)
		// Two uploads of one kind would otherwise both read the same image in
		// use, and the image the first stored would be left with nothing
		// pointing at it.
		if _, err := queries.LockTenantForUpdate(txCtx, tenant.ID); err != nil {
			return nil, s.internalDBError(ctx, "failed to lock tenant for a brand mark upload", err, "tenant_id", tenant.ID.String())
		}
		previous, err := queries.GetTenantBrandMarkImageID(txCtx, dbmodels.GetTenantBrandMarkImageIDParams{TenantID: tenant.ID, Kind: kind})
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, s.internalDBError(ctx, "failed to read the brand mark in use", err, "tenant_id", tenant.ID.String(), "kind", kind)
		}

		// A replace stores a new image rather than overwriting the old object,
		// so the served URL changes and no client keeps serving the previous
		// one from its cache.
		imageID, err := s.storeOwnerImage(txCtx, tenantBrandMarkImages, ownerImageRef(tenant, uuid.Nil, ""), []imageproc.Variant{variant})
		if err != nil {
			return nil, err
		}
		if err := queries.UpsertTenantBrandMark(txCtx, dbmodels.UpsertTenantBrandMarkParams{
			TenantID:              tenant.ID,
			Kind:                  kind,
			ImageID:               uuid.NullUUID{UUID: imageID, Valid: true},
			TermsUrl:              termsURL,
			TermsAcceptedByUserID: uuid.NullUUID{UUID: session.User.ID, Valid: true},
		}); err != nil {
			return nil, s.internalDBError(ctx, "failed to store the brand mark", err, "tenant_id", tenant.ID.String(), "kind", kind)
		}
		if err := s.deleteReplacedBrandMarkImage(txCtx, tenant.ID, kind, previous); err != nil {
			return nil, err
		}
		if err := s.writeTenantSettingAuditOn(txCtx, tenant, session, "tenant_brand_mark_uploaded", "tenant_branding", kind); err != nil {
			return nil, err
		}

		// The variants of the image just stored are visible only inside the
		// transaction until it commits, and the response carries them.
		marks, err := s.tenantBrandMarks(txCtx, tenant.ID)
		if err != nil {
			return nil, err
		}
		for _, mark := range marks {
			if mark.Mark.Kind == req.Kind {
				stored = mark
			}
		}
		return brandMarkRevalidateTags(tenant.ID), nil
	}); err != nil {
		return nil, err
	}
	return &publiraadminv1.UploadTenantBrandMarkResponse{BrandMark: stored}, nil
}

// DeleteTenantBrandMark deletes the tenant's mark of a kind with its consent
// record. A kind the tenant holds no mark of writes nothing and records
// nothing.
func (s *adminServer) DeleteTenantBrandMark(
	ctx context.Context,
	req *publiraadminv1.DeleteTenantBrandMarkRequest,
) (*publiraadminv1.DeleteTenantBrandMarkResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	session, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}

	kind, err := protomapper.TenantBrandMarkKindToStored(req.Kind)
	if err != nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "kind")
	}

	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		queries := s.queriesFor(txCtx)
		if _, err := queries.LockTenantForUpdate(txCtx, tenant.ID); err != nil {
			return nil, s.internalDBError(ctx, "failed to lock tenant for a brand mark delete", err, "tenant_id", tenant.ID.String())
		}
		imageID, err := queries.DeleteTenantBrandMark(txCtx, dbmodels.DeleteTenantBrandMarkParams{TenantID: tenant.ID, Kind: kind})
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to delete the brand mark", err, "tenant_id", tenant.ID.String(), "kind", kind)
		}
		if err := s.deleteReplacedBrandMarkImage(txCtx, tenant.ID, kind, imageID); err != nil {
			return nil, err
		}
		if err := s.writeTenantSettingAuditOn(txCtx, tenant, session, "tenant_brand_mark_deleted", "tenant_branding", kind); err != nil {
			return nil, err
		}
		return brandMarkRevalidateTags(tenant.ID), nil
	}); err != nil {
		return nil, err
	}
	return &publiraadminv1.DeleteTenantBrandMarkResponse{}, nil
}

// deleteReplacedBrandMarkImage drops the image a mark no longer shows, so the
// orphan sweep reclaims its objects. No image is nothing to drop.
func (s *adminServer) deleteReplacedBrandMarkImage(ctx context.Context, tenantID uuid.UUID, kind string, imageID uuid.NullUUID) error {
	if !imageID.Valid {
		return nil
	}
	if err := s.queriesFor(ctx).DeleteTenantImage(ctx, dbmodels.DeleteTenantImageParams{ID: imageID.UUID, TenantID: tenantID}); err != nil {
		return s.internalDBError(ctx, "failed to delete the replaced brand mark image", err, "tenant_id", tenantID.String(), "kind", kind, "tenant_image_id", imageID.UUID.String())
	}
	return nil
}

// tenantBrandMarks reads the tenant's marks as the console sees them, on the
// queries ctx carries.
func (s *adminServer) tenantBrandMarks(ctx context.Context, tenantID uuid.UUID) ([]*publiraadminv1.AdminTenantBrandMark, error) {
	queries := s.queriesFor(ctx)
	rows, err := queries.ListTenantBrandMarks(ctx, tenantID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list brand marks", err, "tenant_id", tenantID.String())
	}
	imageIDs := make([]uuid.UUID, 0, len(rows))
	for _, row := range rows {
		imageIDs = append(imageIDs, row.ImageID.UUID)
	}
	variantsByImageID := map[uuid.UUID][]*publirattypesv1.TenantImageVariant{}
	if len(imageIDs) > 0 {
		variantRows, err := queries.ListTenantImageVariantsByImageIDs(ctx, imageIDs)
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to list brand mark image variants", err, "tenant_id", tenantID.String())
		}
		variantsByImageID = protomapper.TenantImageVariantsByImageID(protomapper.HostRelative, variantRows)
	}

	marks := make([]*publiraadminv1.AdminTenantBrandMark, 0, len(rows))
	for _, row := range rows {
		mark, err := protomapper.TenantBrandMark(protomapper.TenantBrandMarkRow{
			Kind:            row.Kind,
			ImageID:         row.ImageID.UUID,
			ImageUpdatedAt:  row.ImageUpdatedAt,
			TermsURL:        row.TermsUrl,
			TermsAcceptedAt: row.TermsAcceptedAt,
		}, variantsByImageID)
		if err != nil {
			return nil, s.internalError(ctx, "stored brand mark kind is not a supported kind", err, "tenant_id", tenantID.String())
		}
		marks = append(marks, &publiraadminv1.AdminTenantBrandMark{
			Mark:                        mark,
			TermsAcceptedByUserPublicId: row.TermsAcceptedByUserPublicID.String,
			TermsAcceptedByUserName:     row.TermsAcceptedByUserName.String,
		})
	}
	return marks, nil
}

// validateBrandMarkTermsURL accepts an absolute https URL, which is what an
// owner's guideline page is, and answers it as it was sent.
func validateBrandMarkTermsURL(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", errors.New("terms_url is required")
	}
	if len(trimmed) > maxBrandMarkTermsURLLength {
		return "", fmt.Errorf("terms_url must be at most %d bytes", maxBrandMarkTermsURLLength)
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil {
		return "", errors.New("terms_url must be an absolute https URL")
	}
	return trimmed, nil
}
