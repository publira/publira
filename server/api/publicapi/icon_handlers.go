package publicapi

import (
	"context"
	"database/sql"
	"errors"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/api/protomapper"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/imageproc"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/revalidate"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/storage"
	"github.com/publira/publira/server/internal/usericon"
)

// uploadMyIconReadMaxBytes is what UploadMyIcon reads of a request: the
// largest icon it takes, in the base64 of the JSON encoding, which is a third
// larger than the binary one, and the fields sent beside it.
const uploadMyIconReadMaxBytes = (imageproc.UserIconMaxBytes+2)/3*4 + rpcmiddleware.DefaultReadMaxBytes

// userIcons reads the icons the given accounts elect now, uploads and presets
// alike, keyed by account, on the tenant's image origin. An account that shows
// none is absent, and so answers the zero icon.
func (s *apiServer) userIcons(ctx context.Context, q Querier, tenant dbmodels.Tenant, userIDs []uuid.UUID) (map[uuid.UUID]protomapper.UserIcon, error) {
	if len(userIDs) == 0 {
		return nil, nil
	}
	images, err := s.imageOrigin(ctx, tenant)
	if err != nil {
		return nil, err
	}
	rows, err := q.ListUserIconVariantsByUserIDs(ctx, dbmodels.ListUserIconVariantsByUserIDsParams{
		TenantID: tenant.ID,
		UserIds:  userIDs,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list user icon variants", err, "tenant_id", tenant.ID.String())
	}
	return protomapper.UserIconsByUserID(images, rows), nil
}

// ownAccountWithIcon is ownAccount with the icon the account elects, read
// through q so a handler inside a transaction sees the icon it has just
// stored.
func (s *apiServer) ownAccountWithIcon(ctx context.Context, q Querier, tenant dbmodels.Tenant, user dbmodels.User, role string) (*publirattypesv1.User, error) {
	var icon protomapper.UserIcon
	if user.IconImageID.Valid || user.IconPresetID.Valid {
		icons, err := s.userIcons(ctx, q, tenant, []uuid.UUID{user.ID})
		if err != nil {
			return nil, err
		}
		icon = icons[user.ID]
	}
	return ownAccount(user, role, icon), nil
}

// iconCommentListRevalidateTags names the storefront's cached comment list of
// every episode the account has a published comment on. Each list carries the
// URL of the author's icon, and that URL stops answering once the icon is
// replaced or removed, so a list left cached would show a broken image rather
// than only an old one.
func (s *apiServer) iconCommentListRevalidateTags(ctx context.Context, q Querier, tenantID, userID uuid.UUID) ([]string, error) {
	episodePublicIDs, err := q.ListEpisodePublicIDsWithPublishedCommentsByUser(ctx, dbmodels.ListEpisodePublicIDsWithPublishedCommentsByUserParams{
		TenantID: tenantID,
		UserID:   userID,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list the episodes the reader commented on", err, "tenant_id", tenantID.String(), "user_id", userID.String())
	}
	tags := make([]string, 0, len(episodePublicIDs))
	for _, episodePublicID := range episodePublicIDs {
		tags = append(tags, commentListRevalidateTags(tenantID, episodePublicID)...)
	}
	return tags, nil
}

// errReaderIconNotAllowed refuses an icon change the tenant's reader icon
// policy does not allow.
var errReaderIconNotAllowed = errors.New("the tenant's reader icon policy does not allow this icon")

// usericonError reports what usericon refused against the field that caused
// it: the rectangle when the rectangle is at fault, and the image otherwise.
func (s *apiServer) usericonError(ctx context.Context, err error, tenantID, userID uuid.UUID) error {
	switch {
	case errors.Is(err, imageproc.ErrInvalidCrop):
		return rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "icon_crop")
	case errors.Is(err, usericon.ErrInvalidImage):
		return rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "icon_data")
	case errors.Is(err, storage.ErrNotConfigured):
		return rpcerrors.NewErrorInfoError(connect.CodeFailedPrecondition, storage.ErrNotConfigured, rpcerrors.ReasonStorageNotConfigured)
	case errors.Is(err, usericon.ErrPresetNotFound):
		return connect.NewError(connect.CodeNotFound, "reader icon preset not found").WithCause(err)
	case errors.Is(err, usericon.ErrAccountNotFound):
		// The session named an account the tenant no longer holds: it was
		// deleted between the session check and the write.
		return invalidSessionError()
	}
	return s.internalError(ctx, "failed to change the reader icon", err, "tenant_id", tenantID.String(), "user_id", userID.String())
}

// requireReaderIconPolicy refuses an icon change unless the tenant's reader
// icon policy is want, on the transaction tx carries.
//
// The tenant is locked first, so the read sees the policy a change committing
// alongside it leaves: that change clears the icons its policy no longer
// allows once this transaction has committed, and an icon stored under the
// old policy is cleared with them rather than left behind.
func (s *apiServer) requireReaderIconPolicy(ctx context.Context, q Querier, tenantID uuid.UUID, want string) error {
	if _, err := q.LockTenantForReaderIconChange(ctx, tenantID); err != nil {
		return s.internalDBError(ctx, "failed to lock the tenant for an icon change", err, "tenant_id", tenantID.String())
	}
	policy, err := s.readerIconPolicy(ctx, q, tenantID)
	if err != nil {
		return err
	}
	if policy != want {
		return rpcerrors.NewErrorInfoError(connect.CodeFailedPrecondition, errReaderIconNotAllowed, rpcerrors.ReasonReaderIconNotAllowed)
	}
	return nil
}

// readerIconPolicy is the tenant's stored reader icon policy, or
// usericon.PolicyUpload for a tenant that has saved no config row.
func (s *apiServer) readerIconPolicy(ctx context.Context, q Querier, tenantID uuid.UUID) (string, error) {
	stored, err := q.GetTenantReaderIconPolicy(ctx, tenantID)
	if errors.Is(err, sql.ErrNoRows) {
		return usericon.PolicyUpload, nil
	}
	if err != nil {
		return "", s.internalDBError(ctx, "failed to get the tenant's reader icon policy", err, "tenant_id", tenantID.String())
	}
	policy, err := usericon.ResolvePolicy(stored)
	if err != nil {
		return "", s.internalError(ctx, "tenant reader icon policy is not a supported policy", err, "tenant_id", tenantID.String())
	}
	return policy, nil
}

// imageCropRect carries the requested rectangle into imageproc. A nil message
// keeps the centre crop.
func imageCropRect(crop *publirattypesv1.ImageCropRect) *imageproc.CropRect {
	if crop == nil {
		return nil
	}
	return &imageproc.CropRect{
		X:      int(crop.GetX()),
		Y:      int(crop.GetY()),
		Width:  int(crop.GetWidth()),
		Height: int(crop.GetHeight()),
	}
}

// iconChange is what changeMyIcon does to the caller's icon: store upload,
// elect presetID, or, with neither, clear it.
type iconChange struct {
	upload   *usericon.Upload
	presetID uuid.NullUUID
}

// changeMyIcon applies change to the caller's icon and answers the account as
// it then is.
//
// The election and the invalidation of the comment lists that show the old
// icon are one transaction, so a list is never left owing a drop for an icon
// that did not change, nor an icon changed with no drop owed for it.
func (s *apiServer) changeMyIcon(ctx context.Context, tenantCtx *publirattypesv1.TenantContext, change iconChange) (*publirattypesv1.User, error) {
	tenant, user, role, err := s.currentUserFromSession(ctx, tenantCtx, rpcmiddleware.RequestHeader(ctx))
	if err != nil {
		return nil, err
	}
	clearing := change.upload == nil && !change.presetID.Valid
	if clearing && !user.IconImageID.Valid && !user.IconPresetID.Valid {
		return s.ownAccountWithIcon(ctx, s.queriesFor(ctx), tenant, user, role)
	}
	if err := s.chargeReaderAction(ctx, actionChangeIcon, tenant.ID, user.ID); err != nil {
		return nil, err
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin icon change transaction", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txq := dbmodels.New(tx)

	switch {
	case change.upload != nil:
		if err := s.requireReaderIconPolicy(ctx, txq, tenant.ID, usericon.PolicyUpload); err != nil {
			return nil, err
		}
		imageID, setErr := usericon.Set(ctx, txq, s.storage, usericon.Account{
			TenantID:       tenant.ID,
			TenantPublicID: tenant.PublicID,
			UserID:         user.ID,
			UserPublicID:   user.PublicID,
		}, *change.upload)
		if setErr != nil {
			return nil, s.usericonError(ctx, setErr, tenant.ID, user.ID)
		}
		user.IconImageID = uuid.NullUUID{UUID: imageID, Valid: true}
		user.IconPresetID = uuid.NullUUID{}
	case change.presetID.Valid:
		if err := s.requireReaderIconPolicy(ctx, txq, tenant.ID, usericon.PolicyPreset); err != nil {
			return nil, err
		}
		if selectErr := usericon.SelectPreset(ctx, txq, tenant.ID, user.ID, change.presetID.UUID); selectErr != nil {
			return nil, s.usericonError(ctx, selectErr, tenant.ID, user.ID)
		}
		user.IconImageID = uuid.NullUUID{}
		user.IconPresetID = change.presetID
	default:
		if clearErr := usericon.Clear(ctx, txq, tenant.ID, user.ID); clearErr != nil {
			return nil, s.usericonError(ctx, clearErr, tenant.ID, user.ID)
		}
		user.IconImageID = uuid.NullUUID{}
		user.IconPresetID = uuid.NullUUID{}
	}

	tags, err := s.iconCommentListRevalidateTags(ctx, txq, tenant.ID, user.ID)
	if err != nil {
		return nil, err
	}
	var owed revalidate.Owed
	if len(tags) > 0 {
		if owed, err = s.reval.Record(ctx, txq, tenant.ID, tags); err != nil {
			return nil, s.internalDBError(ctx, "failed to record the cache invalidation for an icon change", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
		}
	}

	// The variants of an icon just stored are visible only inside the
	// transaction until it commits, and the response carries them.
	account, err := s.ownAccountWithIcon(ctx, txq, tenant, user, role)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit icon change", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	s.reval.Send(ctx, owed)

	return account, nil
}

// UploadMyIcon sets the caller's icon. The image it replaces is left for the
// orphan sweep, and image-server stops serving it at once.
func (s *apiServer) UploadMyIcon(
	ctx context.Context,
	req *publirav1.UploadMyIconRequest,
) (*publirav1.UploadMyIconResponse, error) {
	account, err := s.changeMyIcon(ctx, req.Tenant, iconChange{upload: &usericon.Upload{
		Data:        req.IconData,
		ContentType: req.IconContentType,
		Crop:        imageCropRect(req.IconCrop),
	}})
	if err != nil {
		return nil, err
	}
	return noStorePrivateResponse(ctx, &publirav1.UploadMyIconResponse{User: account}), nil
}

// SelectMyIcon shows one of the tenant's presets as the caller's icon. An
// upload it replaces is left for the orphan sweep, as a replaced upload is.
func (s *apiServer) SelectMyIcon(
	ctx context.Context,
	req *publirav1.SelectMyIconRequest,
) (*publirav1.SelectMyIconResponse, error) {
	presetID, err := uuid.Parse(req.PresetId)
	if err != nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("preset_id must be a preset id"), "preset_id")
	}
	account, err := s.changeMyIcon(ctx, req.Tenant, iconChange{presetID: uuid.NullUUID{UUID: presetID, Valid: true}})
	if err != nil {
		return nil, err
	}
	return noStorePrivateResponse(ctx, &publirav1.SelectMyIconResponse{User: account}), nil
}

// DeleteMyIcon leaves the caller's account with no icon. A reader may always
// take their icon down, so no reader icon policy refuses it.
func (s *apiServer) DeleteMyIcon(
	ctx context.Context,
	req *publirav1.DeleteMyIconRequest,
) (*publirav1.DeleteMyIconResponse, error) {
	account, err := s.changeMyIcon(ctx, req.Tenant, iconChange{})
	if err != nil {
		return nil, err
	}
	return noStorePrivateResponse(ctx, &publirav1.DeleteMyIconResponse{User: account}), nil
}
