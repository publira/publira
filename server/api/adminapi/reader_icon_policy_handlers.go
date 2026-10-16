package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/api/protomapper"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/imageproc"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/storage"
	"github.com/publira/publira/server/internal/usericon"
)

// maxReaderIconPresets is how many presets one tenant may hold. A reader picks
// from all of them on one screen, which is why neither list is paged, and a
// picker longer than this is not one a reader can choose from.
const maxReaderIconPresets = 50

var errReaderIconPresetLimit = errors.New("the tenant holds as many reader icon presets as it may")

// storedReaderIconPolicy is the tenant's stored reader icon policy, or
// usericon.PolicyUpload for a tenant that has saved no config row.
func (s *adminServer) storedReaderIconPolicy(ctx context.Context, tenantID uuid.UUID) (string, error) {
	stored, err := s.queriesFor(ctx).GetTenantReaderIconPolicy(ctx, tenantID)
	if errors.Is(err, sql.ErrNoRows) {
		return usericon.PolicyUpload, nil
	}
	if err != nil {
		return "", s.internalDBError(ctx, "failed to get the tenant's reader icon policy", err, "tenant_id", tenantID.String())
	}
	return stored, nil
}

// readerIconSettingsRevalidateTag names the storefront's cache of the tenant
// settings the site branches on, which is where it keeps
// TenantService.GetTenantReaderIconPolicy and the presets it answers. A copy
// left cached would keep offering an upload or a preset the API already
// refuses.
func readerIconSettingsRevalidateTag(tenantID uuid.UUID) string {
	return fmt.Sprintf("tenant:%s:site", tenantID.String())
}

// clearedIconCommentListRevalidateTags names the storefront's cached comment
// list of every episode one of the accounts has a published comment on. Each
// list carries the URL of its authors' icons, and that URL stops answering
// once an icon is cleared, so a list left cached would show a broken image.
func (s *adminServer) clearedIconCommentListRevalidateTags(ctx context.Context, tenantID uuid.UUID, userIDs []uuid.UUID) ([]string, error) {
	if len(userIDs) == 0 {
		return nil, nil
	}
	episodePublicIDs, err := s.queriesFor(ctx).ListEpisodePublicIDsWithPublishedCommentsByUsers(ctx, dbmodels.ListEpisodePublicIDsWithPublishedCommentsByUsersParams{
		TenantID: tenantID,
		UserIds:  userIDs,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list the episodes the readers commented on", err, "tenant_id", tenantID.String())
	}
	tags := make([]string, 0, len(episodePublicIDs))
	for _, episodePublicID := range episodePublicIDs {
		tags = append(tags, commentListRevalidateTag(tenantID, episodePublicID))
	}
	return tags, nil
}

func (s *adminServer) GetTenantReaderIconPolicy(
	ctx context.Context,
	req *publiraadminv1.GetTenantReaderIconPolicyRequest,
) (*publiraadminv1.GetTenantReaderIconPolicyResponse, error) {
	if _, err := s.requireTenantAuditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}

	stored, err := s.storedReaderIconPolicy(ctx, tenant.ID)
	if err != nil {
		return nil, err
	}
	policy, err := protomapper.ReaderIconPolicyFromStored(stored)
	if err != nil {
		return nil, s.internalError(ctx, "tenant reader icon policy is not a supported policy", err, "tenant_id", tenant.ID.String())
	}
	return &publiraadminv1.GetTenantReaderIconPolicyResponse{Policy: policy}, nil
}

// UpdateTenantReaderIconPolicy saves the policy and, when it narrows, clears
// the icons it no longer allows in the same transaction: an upload under
// preset, and any icon under disabled. The images cleared are left for the
// orphan sweep, and a preset cleared stays the tenant's.
func (s *adminServer) UpdateTenantReaderIconPolicy(
	ctx context.Context,
	req *publiraadminv1.UpdateTenantReaderIconPolicyRequest,
) (*publiraadminv1.UpdateTenantReaderIconPolicyResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	session, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}

	stored, err := protomapper.ReaderIconPolicyToStored(req.Policy)
	if err != nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "policy")
	}

	saved := stored
	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		queries := s.queriesFor(txCtx)
		if _, err := queries.LockTenantForReaderIconSettings(txCtx, tenant.ID); err != nil {
			return nil, s.internalDBError(ctx, "failed to lock the tenant for a reader icon policy change", err, "tenant_id", tenant.ID.String())
		}
		current, err := s.lockTenantConfig(txCtx, tenant.ID)
		if err != nil {
			return nil, err
		}
		if current.ReaderIconPolicy == stored {
			return nil, nil
		}
		row, err := queries.UpsertTenantReaderIconPolicy(txCtx, dbmodels.UpsertTenantReaderIconPolicyParams{
			TenantID:         tenant.ID,
			ReaderIconPolicy: stored,
		})
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to update tenant reader icon policy", err, "tenant_id", tenant.ID.String())
		}
		saved = row.ReaderIconPolicy

		var cleared []uuid.UUID
		switch stored {
		case usericon.PolicyPreset:
			cleared, err = queries.ClearUploadedReaderIcons(txCtx, uuid.NullUUID{UUID: tenant.ID, Valid: true})
		case usericon.PolicyDisabled:
			cleared, err = queries.ClearAllReaderIcons(txCtx, uuid.NullUUID{UUID: tenant.ID, Valid: true})
		}
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to clear the reader icons the policy no longer allows", err, "tenant_id", tenant.ID.String())
		}

		if err := s.writeTenantSettingAudit(txCtx, tenant, session, "tenant_reader_icon_policy_updated", "tenant_reader_icon_policy"); err != nil {
			return nil, err
		}
		commentListTags, err := s.clearedIconCommentListRevalidateTags(txCtx, tenant.ID, cleared)
		if err != nil {
			return nil, err
		}
		return append([]string{readerIconSettingsRevalidateTag(tenant.ID)}, commentListTags...), nil
	}); err != nil {
		return nil, err
	}

	// The stored row rather than the request: what the console renders next is
	// what the update actually persisted.
	policy, err := protomapper.ReaderIconPolicyFromStored(saved)
	if err != nil {
		return nil, s.internalError(ctx, "tenant reader icon policy is not a supported policy", err, "tenant_id", tenant.ID.String())
	}
	return &publiraadminv1.UpdateTenantReaderIconPolicyResponse{Policy: policy}, nil
}

func (s *adminServer) ListReaderIconPresets(
	ctx context.Context,
	req *publiraadminv1.ListReaderIconPresetsRequest,
) (*publiraadminv1.ListReaderIconPresetsResponse, error) {
	if _, err := s.requireTenantAuditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}

	rows, err := s.queriesFor(ctx).ListReaderIconPresetVariants(ctx, tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list reader icon presets", err, "tenant_id", tenant.ID.String())
	}
	return &publiraadminv1.ListReaderIconPresetsResponse{Presets: protomapper.ReaderIconPresets(rows)}, nil
}

// UploadReaderIconPreset adds one preset to the tenant's set. It is offered to
// readers whenever the policy is preset, whatever the policy is when it is
// added, so a tenant can fill the set before switching to it.
func (s *adminServer) UploadReaderIconPreset(
	ctx context.Context,
	req *publiraadminv1.UploadReaderIconPresetRequest,
) (*publiraadminv1.UploadReaderIconPresetResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	session, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}

	var preset *publirattypesv1.ReaderIconPreset
	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		queries := s.queriesFor(txCtx)
		// Serializes the uploads of one tenant, so two of them cannot both
		// count one short of the limit and both be stored.
		if _, err := queries.LockTenantForReaderIconSettings(txCtx, tenant.ID); err != nil {
			return nil, s.internalDBError(ctx, "failed to lock the tenant for a reader icon preset upload", err, "tenant_id", tenant.ID.String())
		}
		count, err := queries.CountReaderIconPresets(txCtx, tenant.ID)
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to count reader icon presets", err, "tenant_id", tenant.ID.String())
		}
		if count >= maxReaderIconPresets {
			return nil, rpcerrors.NewErrorInfoError(connect.CodeFailedPrecondition, errReaderIconPresetLimit, rpcerrors.ReasonReaderIconPresetLimit)
		}

		presetID, err := usericon.StorePreset(txCtx, queries, s.storage, tenant.ID, tenant.PublicID, usericon.Upload{
			Data:        req.IconData,
			ContentType: req.IconContentType,
			Crop:        imageCropRect(req.IconCrop),
		})
		if err != nil {
			return nil, s.readerIconPresetError(ctx, err, tenant.ID)
		}

		if err := s.writeTenantSettingAudit(txCtx, tenant, session, "tenant_reader_icon_preset_uploaded", "tenant_reader_icon_presets"); err != nil {
			return nil, err
		}

		// The variants of the preset just stored are visible only inside the
		// transaction until it commits, and the response carries them.
		rows, err := queries.ListReaderIconPresetVariants(txCtx, tenant.ID)
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to list reader icon presets", err, "tenant_id", tenant.ID.String())
		}
		for _, stored := range protomapper.ReaderIconPresets(rows) {
			if stored.Id == presetID.String() {
				preset = stored
			}
		}
		return []string{readerIconSettingsRevalidateTag(tenant.ID)}, nil
	}); err != nil {
		return nil, err
	}
	return &publiraadminv1.UploadReaderIconPresetResponse{Preset: preset}, nil
}

// readerIconPresetError reports what usericon refused against the field that
// caused it: the rectangle when the rectangle is at fault, and the image
// otherwise.
func (s *adminServer) readerIconPresetError(ctx context.Context, err error, tenantID uuid.UUID) error {
	switch {
	case errors.Is(err, imageproc.ErrInvalidCrop):
		return rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "icon_crop")
	case errors.Is(err, usericon.ErrInvalidImage):
		return rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "icon_data")
	case errors.Is(err, storage.ErrNotConfigured):
		return rpcerrors.NewErrorInfoError(connect.CodeFailedPrecondition, storage.ErrNotConfigured, rpcerrors.ReasonStorageNotConfigured)
	}
	return s.internalError(ctx, "failed to store a reader icon preset", err, "tenant_id", tenantID.String())
}

// DeleteReaderIconPreset removes one preset from the tenant's set and leaves
// every account that showed it with no icon. image-server stops serving it at
// once, and the orphan sweep reclaims its objects once the row is gone.
func (s *adminServer) DeleteReaderIconPreset(
	ctx context.Context,
	req *publiraadminv1.DeleteReaderIconPresetRequest,
) (*publiraadminv1.DeleteReaderIconPresetResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	session, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	presetID, err := uuid.Parse(req.PresetId)
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, "reader icon preset not found")
	}

	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		queries := s.queriesFor(txCtx)
		if _, err := queries.LockReaderIconPreset(txCtx, dbmodels.LockReaderIconPresetParams{
			TenantID: tenant.ID,
			ID:       presetID,
		}); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, connect.NewError(connect.CodeNotFound, "reader icon preset not found")
			}
			return nil, s.internalDBError(ctx, "failed to lock reader icon preset", err, "tenant_id", tenant.ID.String(), "reader_icon_preset_id", presetID.String())
		}
		cleared, err := queries.ClearReaderIconPresetElections(txCtx, dbmodels.ClearReaderIconPresetElectionsParams{
			TenantID:           uuid.NullUUID{UUID: tenant.ID, Valid: true},
			ReaderIconPresetID: uuid.NullUUID{UUID: presetID, Valid: true},
		})
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to clear the accounts showing a reader icon preset", err, "tenant_id", tenant.ID.String(), "reader_icon_preset_id", presetID.String())
		}
		if _, err := queries.DeleteReaderIconPreset(txCtx, dbmodels.DeleteReaderIconPresetParams{
			TenantID: tenant.ID,
			ID:       presetID,
		}); err != nil {
			return nil, s.internalDBError(ctx, "failed to delete reader icon preset", err, "tenant_id", tenant.ID.String(), "reader_icon_preset_id", presetID.String())
		}
		if err := s.writeTenantSettingAudit(txCtx, tenant, session, "tenant_reader_icon_preset_deleted", "tenant_reader_icon_presets"); err != nil {
			return nil, err
		}
		commentListTags, err := s.clearedIconCommentListRevalidateTags(txCtx, tenant.ID, cleared)
		if err != nil {
			return nil, err
		}
		return append([]string{readerIconSettingsRevalidateTag(tenant.ID)}, commentListTags...), nil
	}); err != nil {
		return nil, err
	}
	return &publiraadminv1.DeleteReaderIconPresetResponse{}, nil
}
