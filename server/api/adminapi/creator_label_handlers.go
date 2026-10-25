package adminapi

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"image"
	"image/draw"
	"image/jpeg"
	"image/png"
	"net/http"
	"strings"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"
	_ "golang.org/x/image/webp"

	"github.com/publira/publira/server/api/protomapper"
	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/catalogindex"
	"github.com/publira/publira/server/internal/clientip"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/imageproc"
	"github.com/publira/publira/server/internal/pagination"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/publicid"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

const (
	creatorIconMaxUploadBytes = 10 << 20
	creatorIconMinDimension   = 256
	defaultCreatorPageSize    = int32(20)
	maxCreatorPageSize        = int32(100)
	defaultLabelPageSize      = int32(20)
	maxLabelPageSize          = int32(100)
)

type creatorPageRow struct {
	id                     uuid.UUID
	publicID               string
	name                   string
	profileText            sql.NullString
	createdAt              time.Time
	iconImageID            uuid.NullUUID
	iconImageFileSizeBytes int64
	iconImageUpdatedAt     sql.NullTime
}

func mapCreatorDescRows(rows []dbmodels.ListCreatorsByTenantDescRow) []creatorPageRow {
	mapped := make([]creatorPageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, creatorPageRow{
			id:                     row.ID,
			publicID:               row.PublicID,
			name:                   row.Name,
			profileText:            row.ProfileText,
			createdAt:              row.CreatedAt,
			iconImageID:            row.IconImageID,
			iconImageFileSizeBytes: row.IconImageFileSizeBytes,
			iconImageUpdatedAt:     row.IconImageUpdatedAt,
		})
	}
	return mapped
}

func mapCreatorAscRows(rows []dbmodels.ListCreatorsByTenantAscRow) []creatorPageRow {
	mapped := make([]creatorPageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, creatorPageRow{
			id:                     row.ID,
			publicID:               row.PublicID,
			name:                   row.Name,
			profileText:            row.ProfileText,
			createdAt:              row.CreatedAt,
			iconImageID:            row.IconImageID,
			iconImageFileSizeBytes: row.IconImageFileSizeBytes,
			iconImageUpdatedAt:     row.IconImageUpdatedAt,
		})
	}
	return mapped
}

type labelPageRow struct {
	id                     uuid.UUID
	publicID               string
	name                   string
	createdAt              time.Time
	eyeCatchImageID        uuid.NullUUID
	eyeCatchImageUpdatedAt sql.NullTime
}

func mapLabelDescRows(rows []dbmodels.ListLabelsByTenantDescRow) []labelPageRow {
	mapped := make([]labelPageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, labelPageRow{
			id:                     row.ID,
			publicID:               row.PublicID,
			name:                   row.Name,
			createdAt:              row.CreatedAt,
			eyeCatchImageID:        row.EyeCatchImageID,
			eyeCatchImageUpdatedAt: row.EyeCatchImageUpdatedAt,
		})
	}
	return mapped
}

func mapLabelAscRows(rows []dbmodels.ListLabelsByTenantAscRow) []labelPageRow {
	mapped := make([]labelPageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, labelPageRow{
			id:                     row.ID,
			publicID:               row.PublicID,
			name:                   row.Name,
			createdAt:              row.CreatedAt,
			eyeCatchImageID:        row.EyeCatchImageID,
			eyeCatchImageUpdatedAt: row.EyeCatchImageUpdatedAt,
		})
	}
	return mapped
}

// normalizeCreatorIconImage cuts the square an icon is delivered as out of an
// upload, as the one variant it is stored as, or nil when the request carried
// no image. A nil crop takes it from the centre of the upload; a crop takes it
// from the named rectangle instead, and the square is then fitted inside that
// rectangle so a selection a few pixels off square still delivers a square.
func normalizeCreatorIconImage(data []byte, contentType string, crop *imageproc.CropRect) ([]imageproc.Variant, error) {
	if len(data) == 0 {
		return nil, nil
	}
	if len(data) > creatorIconMaxUploadBytes {
		return nil, connect.NewError(connect.CodeInvalidArgument, "icon_image_data exceeds 10MB")
	}

	normalizedContentType := strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	if normalizedContentType == "" {
		normalizedContentType = strings.ToLower(strings.TrimSpace(http.DetectContentType(data)))
	}
	if normalizedContentType != "image/jpeg" && normalizedContentType != "image/png" && normalizedContentType != "image/webp" {
		return nil, connect.NewError(connect.CodeInvalidArgument, "icon_image_content_type must be image/jpeg, image/png, or image/webp")
	}

	decoded, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, "icon_image_data is not decodable")
	}
	region := decoded
	if crop != nil {
		region, err = imageproc.CropImage(decoded, *crop)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, err.Error()).WithCause(err)
		}
	}
	bounds := region.Bounds()
	cropSize := bounds.Dx()
	if bounds.Dy() < cropSize {
		cropSize = bounds.Dy()
	}
	if cropSize < creatorIconMinDimension {
		if crop != nil {
			err := fmt.Errorf("%w: icon crop must be at least %dx%d after fitting to a square", imageproc.ErrInvalidCrop, creatorIconMinDimension, creatorIconMinDimension)
			return nil, connect.NewError(connect.CodeInvalidArgument, err.Error()).WithCause(err)
		}
		return nil, connect.NewError(connect.CodeInvalidArgument, "icon image must be at least 256x256")
	}

	origin := image.Point{
		X: bounds.Min.X + (bounds.Dx()-cropSize)/2,
		Y: bounds.Min.Y + (bounds.Dy()-cropSize)/2,
	}
	cropped := image.NewRGBA(image.Rect(0, 0, cropSize, cropSize))
	draw.Draw(cropped, cropped.Bounds(), region, origin, draw.Src)

	encodedContentType := normalizedContentType
	var encoded bytes.Buffer
	switch normalizedContentType {
	case "image/jpeg":
		if err := jpeg.Encode(&encoded, cropped, &jpeg.Options{Quality: 90}); err != nil {
			return nil, connect.NewError(connect.CodeInternal, "failed to encode icon image")
		}
	case "image/png":
		if err := png.Encode(&encoded, cropped); err != nil {
			return nil, connect.NewError(connect.CodeInternal, "failed to encode icon image")
		}
	default:
		encodedContentType = "image/png"
		if err := png.Encode(&encoded, cropped); err != nil {
			return nil, connect.NewError(connect.CodeInternal, "failed to encode icon image")
		}
	}

	return []imageproc.Variant{{
		Label:       "original",
		ContentType: encodedContentType,
		Extension:   extensionFromContentType(encodedContentType),
		Width:       cropSize,
		Height:      cropSize,
		Data:        encoded.Bytes(),
	}}, nil
}

func extensionFromContentType(contentType string) string {
	switch contentType {
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	default:
		return ".jpg"
	}
}

func (s *adminServer) labelPage(
	ctx context.Context,
	tenantID uuid.UUID,
	keys pagination.TimeUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]labelPageRow, error) {
	queries := s.queriesFor(ctx)
	if direction == pagination.Backward {
		rows, err := queries.ListLabelsByTenantAsc(ctx, dbmodels.ListLabelsByTenantAscParams{
			TenantID:        tenantID,
			CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
			CursorInclusive: keys.Inclusive,
			CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
			Limit:           limit,
		})
		if err != nil {
			return nil, err
		}
		return mapLabelAscRows(rows), nil
	}

	rows, err := queries.ListLabelsByTenantDesc(ctx, dbmodels.ListLabelsByTenantDescParams{
		TenantID:        tenantID,
		CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
		CursorInclusive: keys.Inclusive,
		CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
		Limit:           limit,
	})
	if err != nil {
		return nil, err
	}
	return mapLabelDescRows(rows), nil
}

func (s *adminServer) creatorPage(
	ctx context.Context,
	tenantID uuid.UUID,
	keys pagination.TimeUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]creatorPageRow, error) {
	queries := s.queriesFor(ctx)
	if direction == pagination.Backward {
		rows, err := queries.ListCreatorsByTenantAsc(ctx, dbmodels.ListCreatorsByTenantAscParams{
			TenantID:        tenantID,
			CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
			CursorInclusive: keys.Inclusive,
			CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
			Limit:           limit,
		})
		if err != nil {
			return nil, err
		}
		return mapCreatorAscRows(rows), nil
	}

	rows, err := queries.ListCreatorsByTenantDesc(ctx, dbmodels.ListCreatorsByTenantDescParams{
		TenantID:        tenantID,
		CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
		CursorInclusive: keys.Inclusive,
		CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
		Limit:           limit,
	})
	if err != nil {
		return nil, err
	}
	return mapCreatorDescRows(rows), nil
}

func (s *adminServer) ListCreators(
	ctx context.Context,
	req *publiraadminv1.ListCreatorsRequest,
) (*publiraadminv1.ListCreatorsResponse, error) {
	if _, err := s.requireTenantAuditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	limit := pagination.NormalizeLimit(req.Limit, defaultCreatorPageSize, maxCreatorPageSize)
	cursor, err := pagination.Decode(req.Token)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, "token is invalid")
	}
	var keys pagination.TimeUUIDKeys
	if !cursor.IsZero() {
		keys, err = pagination.DecodeTimeUUID(cursor)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, "token is invalid")
		}
	}

	rows, err := s.creatorPage(ctx, tenant.ID, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list creators", err, "tenant_id", tenant.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	items := make([]*publirattypesv1.Creator, 0, len(rows))
	for _, row := range rows {
		item := protomapper.CreatorFromRow(
			protomapper.HostRelative,
			row.publicID,
			row.name,
			row.profileText.String,
			row.iconImageID,
			row.iconImageFileSizeBytes,
			row.iconImageUpdatedAt,
		)
		item.Id = row.id.String()
		items = append(items, item)
	}

	res := &publiraadminv1.ListCreatorsResponse{Creators: items}
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
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		res.PreviousToken = pagination.EncodeTimeUUIDRecovery(pagination.Backward, keys.Time, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		res.NextToken = pagination.EncodeTimeUUIDRecovery(pagination.Forward, keys.Time, keys.ID)
	}

	return res, nil
}

func (s *adminServer) GetCreator(
	ctx context.Context,
	req *publiraadminv1.GetCreatorRequest,
) (*publiraadminv1.GetCreatorResponse, error) {
	if _, err := s.requireTenantAuditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	// Another tenant's creator is filtered out by the query's tenant_id, so it
	// lands on the same not_found as a missing one and never leaks that the
	// record exists.
	row, err := s.queriesFor(ctx).GetCreatorByPublicIDForTenant(ctx, dbmodels.GetCreatorByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.PublicId})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, "creator not found")
		}
		return nil, s.internalDBError(ctx, "failed to get creator", err, "tenant_id", tenant.ID.String())
	}
	accounts, err := s.creatorAccountsForSession(ctx, tenant.ID, row.ID)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.GetCreatorResponse{
		Creator: adminCreator(row.ID, protomapper.CreatorFromRow(
			protomapper.HostRelative,
			row.PublicID,
			row.Name,
			row.ProfileText.String,
			row.IconImageID,
			row.IconImageFileSizeBytes,
			row.IconImageUpdatedAt,
		)),
		Accounts: accounts,
	}, nil
}

func (s *adminServer) ListLabels(
	ctx context.Context,
	req *publiraadminv1.ListLabelsRequest,
) (*publiraadminv1.ListLabelsResponse, error) {
	if _, err := s.requireTenantAuditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	limit := pagination.NormalizeLimit(req.Limit, defaultLabelPageSize, maxLabelPageSize)
	cursor, err := pagination.Decode(req.Token)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, "token is invalid")
	}
	var keys pagination.TimeUUIDKeys
	if !cursor.IsZero() {
		keys, err = pagination.DecodeTimeUUID(cursor)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, "token is invalid")
		}
	}

	rows, err := s.labelPage(ctx, tenant.ID, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list labels", err, "tenant_id", tenant.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	items := make([]*publirattypesv1.Label, 0, len(rows))
	imageIDs := make([]uuid.UUID, 0, len(rows))
	itemByImageID := make(map[uuid.UUID]*publirattypesv1.Label, len(rows))
	for _, row := range rows {
		item := protomapper.LabelWithImage(row.publicID, row.name, row.eyeCatchImageUpdatedAt, nil)
		item.Id = row.id.String()
		items = append(items, item)
		if row.eyeCatchImageID.Valid {
			imageIDs = append(imageIDs, row.eyeCatchImageID.UUID)
			itemByImageID[row.eyeCatchImageID.UUID] = item
		}
	}
	variantsByImageID, err := s.ownerImageVariants(ctx, labelImages, tenant.ID, imageIDs)
	if err != nil {
		return nil, err
	}
	for imageID, variants := range variantsByImageID {
		if item, ok := itemByImageID[imageID]; ok {
			item.EyeCatchImageVariants = variants
		}
	}

	res := &publiraadminv1.ListLabelsResponse{Labels: items}
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
	// An empty page means the boundary row was removed after the token was
	// issued. Hand back a token to where the client came from, so the only way
	// out is not to start over from the first page. A recovery token that comes
	// back empty means the boundary row is gone too: recover once, then leave
	// both tokens empty rather than bouncing the client between empty pages.
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		res.PreviousToken = pagination.EncodeTimeUUIDRecovery(pagination.Backward, keys.Time, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		res.NextToken = pagination.EncodeTimeUUIDRecovery(pagination.Forward, keys.Time, keys.ID)
	}

	return res, nil
}

func (s *adminServer) GetLabel(
	ctx context.Context,
	req *publiraadminv1.GetLabelRequest,
) (*publiraadminv1.GetLabelResponse, error) {
	if _, err := s.requireTenantAuditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	// Another tenant's label is filtered out by the query's tenant_id, so it
	// lands on the same not_found as a missing one and never leaks that the
	// record exists.
	row, err := s.queriesFor(ctx).GetLabelByPublicIDForTenant(ctx, dbmodels.GetLabelByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.PublicId})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, "label not found")
		}
		return nil, s.internalDBError(ctx, "failed to get label", err, "tenant_id", tenant.ID.String())
	}
	var variants []*publirattypesv1.SeriesEyeCatchVariant
	if row.EyeCatchImageID.Valid {
		variantsByImageID, variantErr := s.ownerImageVariants(ctx, labelImages, tenant.ID, []uuid.UUID{row.EyeCatchImageID.UUID})
		if variantErr != nil {
			return nil, variantErr
		}
		variants = variantsByImageID[row.EyeCatchImageID.UUID]
	}
	return &publiraadminv1.GetLabelResponse{Label: adminLabel(row.ID, protomapper.LabelWithImage(row.PublicID, row.Name, row.EyeCatchImageUpdatedAt, variants))}, nil
}

// creatorRevalidateTags names what web-storefront caches a creator under. The
// creator list and the creator detail page read it under `:creators`, and so do
// the series lists that print creator names on their cards; the series detail
// page prints them too and is only reachable under `:series:detail`, so a
// rename that stopped at `:creators` would leave the previous name on that page
// until the entry expired on its own.
func creatorRevalidateTags(tenantID string) []string {
	normalizedTenantID := strings.TrimSpace(tenantID)
	return []string{
		fmt.Sprintf("tenant:%s:creators", normalizedTenantID),
		fmt.Sprintf("tenant:%s:series:detail", normalizedTenantID),
	}
}

func (s *adminServer) CreateCreator(
	ctx context.Context,
	req *publiraadminv1.CreateCreatorRequest,
) (*publiraadminv1.CreateCreatorResponse, error) {
	if _, err := s.requireTenantEditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Name) == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, "name is required")
	}

	iconVariants, err := normalizeCreatorIconImage(req.IconImageData, req.IconImageContentType, imageCropRect(req.IconImageCrop))
	if err != nil {
		return nil, err
	}

	creatorID, err := uuid.NewV7()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err.Error()).WithCause(err)
	}
	// The creator and its icon commit together, so a refused upload leaves no
	// creator behind for the editor's retry to create a second time.
	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin create creator transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txCtx := rpcmiddleware.WithTenantQueries(ctx, dbmodels.New(tx))

	createdBase, err := publicid.InsertTx(txCtx, tx, func(publicID string) (dbmodels.Creator, error) {
		return s.queriesFor(txCtx).CreateCreator(txCtx, dbmodels.CreateCreatorParams{
			ID:          creatorID,
			TenantID:    tenant.ID,
			PublicID:    publicID,
			Name:        req.Name,
			ProfileText: sql.NullString{String: req.ProfileText, Valid: strings.TrimSpace(req.ProfileText) != ""},
			IconImageID: uuid.NullUUID{},
		})
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to create creator", err, "tenant_id", tenant.ID.String())
	}

	iconImageID, err := s.storeOptionalOwnerImage(txCtx, creatorImages, ownerImageRef(tenant, createdBase.ID, createdBase.PublicID), iconVariants)
	if err != nil {
		return nil, err
	}
	if iconImageID.Valid {
		if err := s.queriesFor(txCtx).UpdateCreator(txCtx, dbmodels.UpdateCreatorParams{
			ID:          createdBase.ID,
			Name:        createdBase.Name,
			ProfileText: createdBase.ProfileText,
			IconImageID: iconImageID,
		}); err != nil {
			return nil, s.internalDBError(ctx, "failed to update creator icon", err, "tenant_id", tenant.ID.String(), "creator_id", createdBase.ID.String())
		}
	}
	owed, err := s.recordRevalidation(txCtx, tenant.ID, creatorRevalidateTags(tenant.ID.String()))
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to record the cache invalidation for the created creator", err, "tenant_id", tenant.ID.String(), "creator_id", createdBase.ID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit create creator", err, "tenant_id", tenant.ID.String(), "creator_id", createdBase.ID.String())
	}

	created, err := s.queriesFor(ctx).GetCreatorByPublicIDForTenant(ctx, dbmodels.GetCreatorByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: createdBase.PublicID})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get created creator", err, "tenant_id", tenant.ID.String(), "creator_public_id", createdBase.PublicID)
	}
	if sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx); ok {
		s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
			TenantID:    tenant.ID,
			ActorUserID: sessionCtx.User.ID,
			ActorRole:   sessionCtx.Role,
			Action:      "creator_created",
			TargetType:  "creator",
			TargetID:    createdBase.PublicID,
			Outcome:     auditlog.OutcomeSuccess,
			ClientIP:    clientip.FromContext(ctx),
		})
	}
	s.reval.Send(ctx, owed)
	return &publiraadminv1.CreateCreatorResponse{Creator: adminCreator(created.ID, protomapper.CreatorFromRow(
		protomapper.HostRelative,
		created.PublicID,
		created.Name,
		created.ProfileText.String,
		created.IconImageID,
		created.IconImageFileSizeBytes,
		created.IconImageUpdatedAt,
	))}, nil
}

func (s *adminServer) UpdateCreator(
	ctx context.Context,
	req *publiraadminv1.UpdateCreatorRequest,
) (*publiraadminv1.UpdateCreatorResponse, error) {
	if _, err := s.requireTenantEditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Name) == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, "name is required")
	}
	if req.ClearIconImage && len(req.IconImageData) > 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, "clear_icon_image and icon_image_data cannot be used together")
	}
	iconVariants, err := normalizeCreatorIconImage(req.IconImageData, req.IconImageContentType, imageCropRect(req.IconImageCrop))
	if err != nil {
		return nil, err
	}

	id, err := parseRecordID(req.CreatorId, "creator_id")
	if err != nil {
		return nil, err
	}
	current, err := s.creatorByID(ctx, tenant.ID, id)
	if err != nil {
		return nil, err
	}
	// The new icon commits with the update, so a failed update leaves no icon
	// behind that nothing points at.
	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin update creator transaction", err, "tenant_id", tenant.ID.String(), "creator_id", current.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txCtx := rpcmiddleware.WithTenantQueries(ctx, dbmodels.New(tx))

	iconImageID := current.IconImageID
	if req.ClearIconImage {
		iconImageID = uuid.NullUUID{}
	} else if len(iconVariants) > 0 {
		newIconImageID, uploadErr := s.storeOptionalOwnerImage(txCtx, creatorImages, ownerImageRef(tenant, current.ID, current.PublicID), iconVariants)
		if uploadErr != nil {
			return nil, uploadErr
		}
		iconImageID = newIconImageID
	}

	err = s.queriesFor(txCtx).UpdateCreator(txCtx, dbmodels.UpdateCreatorParams{
		ID:          current.ID,
		Name:        req.Name,
		ProfileText: sql.NullString{String: req.ProfileText, Valid: strings.TrimSpace(req.ProfileText) != ""},
		IconImageID: iconImageID,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to update creator", err, "tenant_id", tenant.ID.String(), "creator_id", current.ID.String())
	}
	if err := catalogindex.Queue(txCtx, s.queriesFor(txCtx), tenant.ID, catalogindex.CreatorRef(current.ID)); err != nil {
		return nil, s.internalDBError(ctx, "failed to queue the search index sync for the updated creator", err, "tenant_id", tenant.ID.String(), "creator_id", current.ID.String())
	}
	owed, err := s.recordRevalidation(txCtx, tenant.ID, creatorRevalidateTags(tenant.ID.String()))
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to record the cache invalidation for the updated creator", err, "tenant_id", tenant.ID.String(), "creator_id", current.ID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit update creator", err, "tenant_id", tenant.ID.String(), "creator_id", current.ID.String())
	}

	updated, err := s.creatorByID(ctx, tenant.ID, id)
	if err != nil {
		return nil, err
	}
	if sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx); ok {
		s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
			TenantID:    tenant.ID,
			ActorUserID: sessionCtx.User.ID,
			ActorRole:   sessionCtx.Role,
			Action:      "creator_updated",
			TargetType:  "creator",
			TargetID:    updated.PublicID,
			Outcome:     auditlog.OutcomeSuccess,
			ClientIP:    clientip.FromContext(ctx),
		})
	}
	s.reval.Send(ctx, owed)
	return &publiraadminv1.UpdateCreatorResponse{Creator: adminCreator(updated.ID, protomapper.CreatorFromRow(
		protomapper.HostRelative,
		updated.PublicID,
		updated.Name,
		updated.ProfileText.String,
		updated.IconImageID,
		updated.IconImageFileSizeBytes,
		updated.IconImageUpdatedAt,
	))}, nil
}

// labelRevalidateTags names what web-storefront caches a label under. The label
// list and the label detail page read it under `:labels`, and every series card
// and series detail page renders the name of the series' label, so a rename
// that stopped at `:labels` would leave the previous name on the storefront
// until those entries expired on their own.
func labelRevalidateTags(tenantID string) []string {
	normalizedTenantID := strings.TrimSpace(tenantID)
	return []string{
		fmt.Sprintf("tenant:%s:labels", normalizedTenantID),
		fmt.Sprintf("tenant:%s:series:list", normalizedTenantID),
		fmt.Sprintf("tenant:%s:series:detail", normalizedTenantID),
	}
}

func (s *adminServer) CreateLabel(
	ctx context.Context,
	req *publiraadminv1.CreateLabelRequest,
) (*publiraadminv1.CreateLabelResponse, error) {
	if _, err := s.requireTenantEditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Name) == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, "name is required")
	}
	eyeCatchVariants, err := s.eyeCatchVariants(req.EyeCatchImageData, req.EyeCatchImageContentType)
	if err != nil {
		return nil, err
	}
	labelID, err := uuid.NewV7()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err.Error()).WithCause(err)
	}
	// The label and its eye-catch commit together, so a refused upload leaves
	// no label behind for the editor's retry to create a second time.
	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin create label transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txCtx := rpcmiddleware.WithTenantQueries(ctx, dbmodels.New(tx))

	createdBase, err := publicid.InsertTx(txCtx, tx, func(publicID string) (dbmodels.Label, error) {
		return s.queriesFor(txCtx).CreateLabel(txCtx, dbmodels.CreateLabelParams{
			ID:              labelID,
			TenantID:        tenant.ID,
			PublicID:        publicID,
			Name:            req.Name,
			EyeCatchImageID: uuid.NullUUID{},
		})
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to create label", err, "tenant_id", tenant.ID.String())
	}
	eyeCatchImageID, err := s.storeOptionalOwnerImage(txCtx, labelImages, ownerImageRef(tenant, createdBase.ID, createdBase.PublicID), eyeCatchVariants)
	if err != nil {
		return nil, err
	}
	if eyeCatchImageID.Valid {
		if err := s.queriesFor(txCtx).UpdateLabel(txCtx, dbmodels.UpdateLabelParams{
			ID:              createdBase.ID,
			Name:            createdBase.Name,
			EyeCatchImageID: eyeCatchImageID,
		}); err != nil {
			return nil, s.internalDBError(ctx, "failed to update label eye catch image", err, "tenant_id", tenant.ID.String(), "label_id", createdBase.ID.String())
		}
	}
	owed, err := s.recordRevalidation(txCtx, tenant.ID, labelRevalidateTags(tenant.ID.String()))
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to record the cache invalidation for the created label", err, "tenant_id", tenant.ID.String(), "label_id", createdBase.ID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit create label", err, "tenant_id", tenant.ID.String(), "label_id", createdBase.ID.String())
	}

	created, err := s.queriesFor(ctx).GetLabelByPublicIDForTenant(ctx, dbmodels.GetLabelByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: createdBase.PublicID})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get created label", err, "tenant_id", tenant.ID.String(), "label_public_id", createdBase.PublicID)
	}
	var variants []*publirattypesv1.SeriesEyeCatchVariant
	if created.EyeCatchImageID.Valid {
		variantsByImageID, variantErr := s.ownerImageVariants(ctx, labelImages, tenant.ID, []uuid.UUID{created.EyeCatchImageID.UUID})
		if variantErr != nil {
			return nil, variantErr
		}
		variants = variantsByImageID[created.EyeCatchImageID.UUID]
	}
	if sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx); ok {
		s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
			TenantID:    tenant.ID,
			ActorUserID: sessionCtx.User.ID,
			ActorRole:   sessionCtx.Role,
			Action:      "label_created",
			TargetType:  "label",
			TargetID:    created.PublicID,
			Outcome:     auditlog.OutcomeSuccess,
			ClientIP:    clientip.FromContext(ctx),
		})
	}
	s.reval.Send(ctx, owed)
	return &publiraadminv1.CreateLabelResponse{Label: adminLabel(created.ID, protomapper.LabelWithImage(created.PublicID, created.Name, created.EyeCatchImageUpdatedAt, variants))}, nil
}

func (s *adminServer) UpdateLabel(
	ctx context.Context,
	req *publiraadminv1.UpdateLabelRequest,
) (*publiraadminv1.UpdateLabelResponse, error) {
	if _, err := s.requireTenantEditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Name) == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, "name is required")
	}
	if req.ClearEyeCatchImage && len(req.EyeCatchImageData) > 0 {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("clear_eye_catch_image and eye_catch_image_data cannot be used together"), "eye_catch_image_data")
	}
	eyeCatchVariants, err := s.eyeCatchVariants(req.EyeCatchImageData, req.EyeCatchImageContentType)
	if err != nil {
		return nil, err
	}
	id, err := parseRecordID(req.LabelId, "label_id")
	if err != nil {
		return nil, err
	}
	current, err := s.labelByID(ctx, tenant.ID, id)
	if err != nil {
		return nil, err
	}
	// The new eye-catch commits with the update, so a failed update leaves no
	// eye-catch behind that nothing points at.
	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin update label transaction", err, "tenant_id", tenant.ID.String(), "label_id", current.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txCtx := rpcmiddleware.WithTenantQueries(ctx, dbmodels.New(tx))

	eyeCatchImageID := current.EyeCatchImageID
	if req.ClearEyeCatchImage {
		eyeCatchImageID = uuid.NullUUID{}
	} else if len(eyeCatchVariants) > 0 {
		newEyeCatchImageID, uploadErr := s.storeOptionalOwnerImage(txCtx, labelImages, ownerImageRef(tenant, current.ID, current.PublicID), eyeCatchVariants)
		if uploadErr != nil {
			return nil, uploadErr
		}
		eyeCatchImageID = newEyeCatchImageID
	}
	err = s.queriesFor(txCtx).UpdateLabel(txCtx, dbmodels.UpdateLabelParams{ID: current.ID, Name: req.Name, EyeCatchImageID: eyeCatchImageID})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to update label", err, "tenant_id", tenant.ID.String(), "label_id", current.ID.String())
	}
	if err := catalogindex.Queue(txCtx, s.queriesFor(txCtx), tenant.ID, catalogindex.LabelRef(current.ID)); err != nil {
		return nil, s.internalDBError(ctx, "failed to queue the search index sync for the updated label", err, "tenant_id", tenant.ID.String(), "label_id", current.ID.String())
	}
	owed, err := s.recordRevalidation(txCtx, tenant.ID, labelRevalidateTags(tenant.ID.String()))
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to record the cache invalidation for the updated label", err, "tenant_id", tenant.ID.String(), "label_id", current.ID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit update label", err, "tenant_id", tenant.ID.String(), "label_id", current.ID.String())
	}

	updated, err := s.labelByID(ctx, tenant.ID, id)
	if err != nil {
		return nil, err
	}
	var variants []*publirattypesv1.SeriesEyeCatchVariant
	if updated.EyeCatchImageID.Valid {
		variantsByImageID, variantErr := s.ownerImageVariants(ctx, labelImages, tenant.ID, []uuid.UUID{updated.EyeCatchImageID.UUID})
		if variantErr != nil {
			return nil, variantErr
		}
		variants = variantsByImageID[updated.EyeCatchImageID.UUID]
	}
	if sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx); ok {
		s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
			TenantID:    tenant.ID,
			ActorUserID: sessionCtx.User.ID,
			ActorRole:   sessionCtx.Role,
			Action:      "label_updated",
			TargetType:  "label",
			TargetID:    updated.PublicID,
			Outcome:     auditlog.OutcomeSuccess,
			ClientIP:    clientip.FromContext(ctx),
		})
	}
	s.reval.Send(ctx, owed)
	return &publiraadminv1.UpdateLabelResponse{Label: adminLabel(updated.ID, protomapper.LabelWithImage(updated.PublicID, updated.Name, updated.EyeCatchImageUpdatedAt, variants))}, nil
}

// adminCreator is a creator as the admin API answers with it: the catalog's
// shape plus the primary key the console addresses the creator by.
func adminCreator(id uuid.UUID, creator *publirattypesv1.Creator) *publirattypesv1.Creator {
	creator.Id = id.String()
	return creator
}

// adminLabel is a label as the admin API answers with it, with the primary key
// the console addresses the label by.
func adminLabel(id uuid.UUID, label *publirattypesv1.Label) *publirattypesv1.Label {
	label.Id = id.String()
	return label
}

// creatorByID reads the creator a request names.
func (s *adminServer) creatorByID(ctx context.Context, tenantID, id uuid.UUID) (dbmodels.GetCreatorByIDForTenantRow, error) {
	row, err := s.queriesFor(ctx).GetCreatorByIDForTenant(ctx, dbmodels.GetCreatorByIDForTenantParams{TenantID: tenantID, ID: id})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dbmodels.GetCreatorByIDForTenantRow{}, connect.NewError(connect.CodeNotFound, "creator not found")
		}
		return dbmodels.GetCreatorByIDForTenantRow{}, s.internalDBError(ctx, "failed to get creator", err, "tenant_id", tenantID.String(), "creator_id", id.String())
	}
	return row, nil
}

// labelByID reads the label a request names.
func (s *adminServer) labelByID(ctx context.Context, tenantID, id uuid.UUID) (dbmodels.GetLabelByIDForTenantRow, error) {
	row, err := s.queriesFor(ctx).GetLabelByIDForTenant(ctx, dbmodels.GetLabelByIDForTenantParams{TenantID: tenantID, ID: id})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dbmodels.GetLabelByIDForTenantRow{}, connect.NewError(connect.CodeNotFound, "label not found")
		}
		return dbmodels.GetLabelByIDForTenantRow{}, s.internalDBError(ctx, "failed to get label", err, "tenant_id", tenantID.String(), "label_id", id.String())
	}
	return row, nil
}

// lockLabelByID takes the row lock every eye-catch write on one label
// serializes behind; the caller re-reads eye_catch_image_id after it.
func (s *adminServer) lockLabelByID(ctx context.Context, tenantID, id uuid.UUID) error {
	if _, err := s.queriesFor(ctx).LockLabelByIDForTenant(ctx, dbmodels.LockLabelByIDForTenantParams{TenantID: tenantID, ID: id}); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return connect.NewError(connect.CodeNotFound, "label not found")
		}
		return s.internalDBError(ctx, "failed to lock label", err, "tenant_id", tenantID.String(), "label_id", id.String())
	}
	return nil
}
