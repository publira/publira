package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"
	"net/http"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/catalogslug"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/dberr"
	"github.com/publira/publira/server/internal/imageproc"
	"github.com/publira/publira/server/internal/pagination"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/publicid"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/storage"
)

const (
	defaultGenrePageSize = int32(20)
	maxGenrePageSize     = int32(100)

	// maxCatalogNameRunes bounds a genre or tag name. It counts code points
	// rather than bytes, so a name costs the same length in every script. The
	// bound is what a filter chip and a series card can show; a classification
	// longer than that is a synopsis.
	maxCatalogNameRunes = 50
)

// normalizedCatalogName is a genre or tag name as it is stored, alongside the
// slug derived from it.
type normalizedCatalogName struct {
	name string
	slug string
}

// normalizeCatalogName trims a genre or tag name and derives its slug. field
// names the request field, so the console can put the message on the input the
// editor typed into.
func normalizeCatalogName(raw, field string) (normalizedCatalogName, error) {
	name := strings.TrimSpace(raw)
	if name == "" {
		return normalizedCatalogName{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, fmt.Errorf("%s is required", field), field)
	}
	if utf8.RuneCountInString(name) > maxCatalogNameRunes {
		return normalizedCatalogName{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, fmt.Errorf("%s must be at most %d characters", field, maxCatalogNameRunes), field)
	}
	slug, err := catalogslug.FromName(name)
	if err != nil {
		return normalizedCatalogName{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, fmt.Errorf("%s must hold at least one letter or digit", field), field)
	}
	return normalizedCatalogName{name: name, slug: slug}, nil
}

func genreRevalidateTags(tenantID string) []string {
	normalizedTenantID := strings.TrimSpace(tenantID)
	return []string{
		fmt.Sprintf("tenant:%s:genres", normalizedTenantID),
		fmt.Sprintf("tenant:%s:series:list", normalizedTenantID),
		fmt.Sprintf("tenant:%s:series:detail", normalizedTenantID),
	}
}

// recordGenreChange files the audit entry for one genre write. Every genre RPC
// changes the classification every series is read through, so all of them are
// recorded, not only the destructive one.
func (s *adminServer) recordGenreChange(ctx context.Context, tenantID uuid.UUID, header http.Header, action, targetID string) {
	sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx)
	if !ok {
		return
	}
	s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    tenantID,
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		Action:      action,
		TargetType:  "genre",
		TargetID:    targetID,
		Outcome:     auditlog.OutcomeSuccess,
		ClientIP:    auditlog.ClientIPFromHeader(header),
	})
}

// genreRow is a genre as every admin genre RPC answers with it, whichever
// query read it.
type genreRow struct {
	publicID               string
	name                   string
	slug                   string
	eyeCatchImageID        uuid.NullUUID
	eyeCatchImageUpdatedAt sql.NullTime
}

func genreRowFromGet(row dbmodels.GetGenreByPublicIDForTenantRow) genreRow {
	return genreRow{
		publicID:               row.PublicID,
		name:                   row.Name,
		slug:                   row.Slug,
		eyeCatchImageID:        row.EyeCatchImageID,
		eyeCatchImageUpdatedAt: row.EyeCatchImageUpdatedAt,
	}
}

// genrePageRow is one row of a genre page, shared by the ascending and
// descending keyset queries so the handler reads a single shape.
type genrePageRow struct {
	genreRow
	id           uuid.UUID
	displayOrder int32
}

func mapGenreAscRows(rows []dbmodels.ListGenresByTenantAscRow) []genrePageRow {
	mapped := make([]genrePageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, genrePageRow{
			genreRow: genreRow{
				publicID:               row.PublicID,
				name:                   row.Name,
				slug:                   row.Slug,
				eyeCatchImageID:        row.EyeCatchImageID,
				eyeCatchImageUpdatedAt: row.EyeCatchImageUpdatedAt,
			},
			id:           row.ID,
			displayOrder: row.DisplayOrder,
		})
	}
	return mapped
}

func mapGenreDescRows(rows []dbmodels.ListGenresByTenantDescRow) []genrePageRow {
	mapped := make([]genrePageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, genrePageRow{
			genreRow: genreRow{
				publicID:               row.PublicID,
				name:                   row.Name,
				slug:                   row.Slug,
				eyeCatchImageID:        row.EyeCatchImageID,
				eyeCatchImageUpdatedAt: row.EyeCatchImageUpdatedAt,
			},
			id:           row.ID,
			displayOrder: row.DisplayOrder,
		})
	}
	return mapped
}

// genreMessages builds the answer for a list of genres, reading the variants
// of every eye-catch among them in one query.
func (s *adminServer) genreMessages(ctx context.Context, rows []genreRow) ([]*publirattypesv1.Genre, error) {
	genres := make([]*publirattypesv1.Genre, 0, len(rows))
	imageIDs := make([]uuid.UUID, 0, len(rows))
	genreByImageID := make(map[uuid.UUID]*publirattypesv1.Genre, len(rows))
	for _, row := range rows {
		genre := &publirattypesv1.Genre{PublicId: row.publicID, Name: row.name, Slug: row.slug}
		if row.eyeCatchImageUpdatedAt.Valid {
			genre.EyeCatchImageUpdatedAt = row.eyeCatchImageUpdatedAt.Time.UTC().Format(time.RFC3339)
		}
		genres = append(genres, genre)
		if row.eyeCatchImageID.Valid {
			imageIDs = append(imageIDs, row.eyeCatchImageID.UUID)
			genreByImageID[row.eyeCatchImageID.UUID] = genre
		}
	}
	variantsByImageID, err := s.genreEyeCatchVariantsByImageIDs(ctx, imageIDs)
	if err != nil {
		return nil, err
	}
	for imageID, variants := range variantsByImageID {
		if genre, ok := genreByImageID[imageID]; ok {
			genre.EyeCatchImageVariants = variants
		}
	}
	return genres, nil
}

func (s *adminServer) genreMessage(ctx context.Context, row genreRow) (*publirattypesv1.Genre, error) {
	genres, err := s.genreMessages(ctx, []genreRow{row})
	if err != nil {
		return nil, err
	}
	return genres[0], nil
}

func (s *adminServer) genreEyeCatchVariantsByImageIDs(
	ctx context.Context,
	imageIDs []uuid.UUID,
) (map[uuid.UUID][]*publirattypesv1.SeriesEyeCatchVariant, error) {
	if len(imageIDs) == 0 {
		return map[uuid.UUID][]*publirattypesv1.SeriesEyeCatchVariant{}, nil
	}

	rows, err := s.queriesFor(ctx).ListGenreImageVariantsByImageIDs(ctx, imageIDs)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list genre image variants", err)
	}

	mapped := make(map[uuid.UUID][]*publirattypesv1.SeriesEyeCatchVariant, len(imageIDs))
	for _, row := range rows {
		mapped[row.GenreImageID] = append(mapped[row.GenreImageID], &publirattypesv1.SeriesEyeCatchVariant{
			Label:         row.Label,
			VariantType:   row.VariantType,
			Url:           fmt.Sprintf("/images/genres/%s/%s/%d", row.GenreImageID.String(), row.VariantType, row.Width),
			ContentType:   row.ContentType,
			Width:         row.Width,
			Height:        row.Height,
			FileSizeBytes: row.FileSizeBytes,
		})
	}
	return mapped, nil
}

// genreEyeCatchVariants cuts an uploaded eye-catch into every ratio before
// the caller opens its transaction, so a refused image costs no database work
// and the cut does not run while the genre row is held. Nil means no upload.
func (s *adminServer) genreEyeCatchVariants(data []byte, contentType string) ([]imageproc.Variant, error) {
	image, err := normalizeEyeCatchImage(data, contentType, "eye_catch_image_data", "eye_catch_image_content_type")
	if err != nil || image == nil {
		return nil, err
	}
	if s.storage == nil {
		return nil, connect.NewError(connect.CodeInternal, errors.New("storage provider is not configured"))
	}
	variants, err := imageproc.BuildEyeCatchVariants(image.Data, image.ContentType)
	if err != nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "eye_catch_image_data")
	}
	return variants, nil
}

func (s *adminServer) createGenreEyeCatchImage(ctx context.Context, tenant dbmodels.Tenant, genreID uuid.UUID, genrePublicID string, variants []imageproc.Variant) (uuid.NullUUID, error) {
	if len(variants) == 0 {
		return uuid.NullUUID{}, nil
	}

	genreImageID, err := uuid.NewV7()
	if err != nil {
		return uuid.NullUUID{}, connect.NewError(connect.CodeInternal, err)
	}
	createdImage, err := s.queriesFor(ctx).CreateGenreImage(ctx, dbmodels.CreateGenreImageParams{
		ID:       genreImageID,
		TenantID: tenant.ID,
		GenreID:  genreID,
	})
	if err != nil {
		return uuid.NullUUID{}, s.internalDBError(ctx, "failed to create genre image", err, "tenant_id", tenant.ID.String(), "genre_id", genreID.String())
	}

	store, err := storage.Pin(ctx, s.storage)
	if err != nil {
		return uuid.NullUUID{}, storageUploadError(err)
	}
	for _, variant := range variants {
		uploaded, uploadErr := store.Upload(ctx, storage.UploadRequest{
			ObjectKey: fmt.Sprintf(
				"tenants/%s/genres/%s/%s-%s%s",
				tenant.PublicID,
				genrePublicID,
				createdImage.ID.String(),
				variant.Label,
				variant.Extension,
			),
			ContentType: variant.ContentType,
			Data:        variant.Data,
		})
		if uploadErr != nil {
			return uuid.NullUUID{}, storageUploadError(uploadErr)
		}

		variantID, variantIDErr := uuid.NewV7()
		if variantIDErr != nil {
			return uuid.NullUUID{}, connect.NewError(connect.CodeInternal, variantIDErr)
		}
		if _, createErr := s.queriesFor(ctx).CreateGenreImageVariant(ctx, dbmodels.CreateGenreImageVariantParams{
			ID:              variantID,
			TenantID:        tenant.ID,
			GenreImageID:    createdImage.ID,
			VariantType:     variant.VariantType,
			Label:           variant.Label,
			StorageProvider: uploaded.Provider,
			ObjectKey:       uploaded.ObjectKey,
			ContentType:     variant.ContentType,
			FileSizeBytes:   uploaded.SizeBytes,
			Width:           int32(variant.Width),
			Height:          int32(variant.Height),
		}); createErr != nil {
			return uuid.NullUUID{}, s.internalDBError(ctx, "failed to create genre image variant", createErr, "tenant_id", tenant.ID.String(), "genre_image_id", createdImage.ID.String())
		}
	}

	return uuid.NullUUID{UUID: createdImage.ID, Valid: true}, nil
}

// genrePage runs the keyset query for one page. The list reads in the tenant's
// own order, so a backward page is scanned by the descending query and put
// back into display order by pagination.Page.
func (s *adminServer) genrePage(
	ctx context.Context,
	tenantID uuid.UUID,
	keys pagination.CountUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]genrePageRow, error) {
	queries := s.queriesFor(ctx)
	if direction == pagination.Backward {
		rows, err := queries.ListGenresByTenantDesc(ctx, dbmodels.ListGenresByTenantDescParams{
			TenantID:           tenantID,
			CursorID:           uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
			CursorInclusive:    keys.Inclusive,
			CursorDisplayOrder: sql.NullInt32{Int32: int32(keys.Count), Valid: keys.Valid},
			Limit:              limit,
		})
		if err != nil {
			return nil, err
		}
		return mapGenreDescRows(rows), nil
	}

	rows, err := queries.ListGenresByTenantAsc(ctx, dbmodels.ListGenresByTenantAscParams{
		TenantID:           tenantID,
		CursorID:           uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
		CursorInclusive:    keys.Inclusive,
		CursorDisplayOrder: sql.NullInt32{Int32: int32(keys.Count), Valid: keys.Valid},
		Limit:              limit,
	})
	if err != nil {
		return nil, err
	}
	return mapGenreAscRows(rows), nil
}

func (s *adminServer) ListGenres(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ListGenresRequest],
) (*connect.Response[publiraadminv1.ListGenresResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultGenrePageSize, maxGenrePageSize)
	cursor, err := pagination.Decode(req.Msg.Token)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	}
	var keys pagination.CountUUIDKeys
	if !cursor.IsZero() {
		keys, err = pagination.DecodeCountUUID(cursor)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
		}
		// The count a token carries is the display_order it was built from, and
		// display_order is an int4. A client-supplied value outside that range
		// would silently wrap on the way into the query and compare against a
		// position no genre holds, so it is refused instead.
		if keys.Count < math.MinInt32 || keys.Count > math.MaxInt32 {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
		}
	}

	// One row past the page: its presence is what says another page exists.
	rows, err := s.genrePage(ctx, tenant.ID, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list genres", err, "tenant_id", tenant.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	genreRows := make([]genreRow, 0, len(rows))
	for _, row := range rows {
		genreRows = append(genreRows, row.genreRow)
	}
	genres, err := s.genreMessages(ctx, genreRows)
	if err != nil {
		return nil, err
	}

	res := &publiraadminv1.ListGenresResponse{Genres: genres}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = pagination.EncodeCountUUID(pagination.Backward, int64(rows[0].displayOrder), rows[0].id)
		}
		if hasNext {
			last := rows[len(rows)-1]
			res.NextToken = pagination.EncodeCountUUID(pagination.Forward, int64(last.displayOrder), last.id)
		}
	// An empty page means the boundary genre was deleted, or moved by a
	// reorder, after the token was issued. Hand back a token to where the
	// client came from, and recover only once: a recovery token that also
	// comes back empty leaves both tokens empty so the client falls back to
	// the first page instead of bouncing between empty ones.
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		res.PreviousToken = pagination.EncodeCountUUIDRecovery(pagination.Backward, keys.Count, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		res.NextToken = pagination.EncodeCountUUIDRecovery(pagination.Forward, keys.Count, keys.ID)
	}

	return connect.NewResponse(res), nil
}

func (s *adminServer) CreateGenre(
	ctx context.Context,
	req *connect.Request[publiraadminv1.CreateGenreRequest],
) (*connect.Response[publiraadminv1.CreateGenreResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	normalized, err := normalizeCatalogName(req.Msg.Name, "name")
	if err != nil {
		return nil, err
	}
	eyeCatchVariants, err := s.genreEyeCatchVariants(req.Msg.EyeCatchImageData, req.Msg.EyeCatchImageContentType)
	if err != nil {
		return nil, err
	}
	genreID, err := uuid.NewV7()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// The genre and its eye-catch commit together. A genre left behind by a
	// failed upload would hold the name, and the editor's retry would be
	// refused as a duplicate of it.
	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin create genre transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txCtx := rpcmiddleware.WithTenantQueries(ctx, dbmodels.New(tx))

	maxDisplayOrder, err := s.queriesFor(txCtx).GetMaxGenreDisplayOrderForTenant(txCtx, tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to resolve the next genre display order", err, "tenant_id", tenant.ID.String())
	}
	created, err := publicid.InsertTx(txCtx, tx, func(publicID string) (dbmodels.Genre, error) {
		return s.queriesFor(txCtx).CreateGenre(txCtx, dbmodels.CreateGenreParams{
			ID:           genreID,
			TenantID:     tenant.ID,
			PublicID:     publicID,
			Name:         normalized.name,
			Slug:         normalized.slug,
			DisplayOrder: maxDisplayOrder + 1,
		})
	})
	if err != nil {
		if dberr.IsUniqueViolation(err) {
			return nil, existingGenreNameError()
		}
		return nil, s.internalDBError(ctx, "failed to create genre", err, "tenant_id", tenant.ID.String())
	}
	eyeCatchImageID, err := s.createGenreEyeCatchImage(txCtx, tenant, created.ID, created.PublicID, eyeCatchVariants)
	if err != nil {
		return nil, err
	}
	if eyeCatchImageID.Valid {
		if err := s.queriesFor(txCtx).UpdateGenre(txCtx, dbmodels.UpdateGenreParams{
			ID:              created.ID,
			Name:            created.Name,
			Slug:            created.Slug,
			EyeCatchImageID: eyeCatchImageID,
		}); err != nil {
			return nil, s.internalDBError(ctx, "failed to point the genre at its eye catch image", err, "tenant_id", tenant.ID.String(), "genre_id", created.ID.String())
		}
	}
	owed, err := s.recordRevalidation(txCtx, tenant.ID, genreRevalidateTags(tenant.ID.String()))
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to record the cache invalidation for the created genre", err, "tenant_id", tenant.ID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit create genre", err, "tenant_id", tenant.ID.String())
	}
	s.reval.Send(ctx, owed)

	s.recordGenreChange(ctx, tenant.ID, req.Header(), "genre_created", created.PublicID)

	genre, err := s.genreWithEyeCatch(ctx, tenant.ID, created.PublicID)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&publiraadminv1.CreateGenreResponse{Genre: genre}), nil
}

// genreWithEyeCatch re-reads a genre after a write, so the answer carries the
// eye-catch delivery now serves.
func (s *adminServer) genreWithEyeCatch(ctx context.Context, tenantID uuid.UUID, publicID string) (*publirattypesv1.Genre, error) {
	row, err := s.genreByPublicID(ctx, tenantID, publicID)
	if err != nil {
		return nil, err
	}
	return s.genreMessage(ctx, genreRowFromGet(row))
}

// existingGenreNameError reports a name whose slug another genre of the tenant
// already holds. The two names may differ on screen — "Slice of Life" against
// "slice of life" — so the message says what collided rather than repeating
// the name back.
func existingGenreNameError() error {
	return rpcerrors.NewFieldViolationError(
		connect.CodeAlreadyExists,
		errors.New("a genre with this name already exists"),
		"name",
	)
}

func (s *adminServer) UpdateGenre(
	ctx context.Context,
	req *connect.Request[publiraadminv1.UpdateGenreRequest],
) (*connect.Response[publiraadminv1.UpdateGenreResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	normalized, err := normalizeCatalogName(req.Msg.Name, "name")
	if err != nil {
		return nil, err
	}
	if req.Msg.ClearEyeCatchImage && len(req.Msg.EyeCatchImageData) > 0 {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("clear_eye_catch_image and eye_catch_image_data cannot be used together"), "eye_catch_image_data")
	}
	eyeCatchVariants, err := s.genreEyeCatchVariants(req.Msg.EyeCatchImageData, req.Msg.EyeCatchImageContentType)
	if err != nil {
		return nil, err
	}
	publicID := strings.TrimSpace(req.Msg.PublicId)

	// Committed with the rename, so a name another genre holds does not leave
	// an eye-catch behind that nothing shows.
	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin update genre transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txCtx := rpcmiddleware.WithTenantQueries(ctx, dbmodels.New(tx))

	// Every update writes eye_catch_image_id back, so it is read behind the
	// lock: a rename racing a clear or a replacement would otherwise restore
	// the eye-catch the other write had just changed.
	if _, err := s.queriesFor(txCtx).LockGenreByPublicIDForTenant(txCtx, dbmodels.LockGenreByPublicIDForTenantParams{
		TenantID: tenant.ID,
		PublicID: publicID,
	}); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("genre not found"))
		}
		return nil, s.internalDBError(ctx, "failed to lock genre for update", err, "tenant_id", tenant.ID.String(), "genre_public_id", publicID)
	}
	current, err := s.genreByPublicID(txCtx, tenant.ID, publicID)
	if err != nil {
		return nil, err
	}

	eyeCatchImageID := current.EyeCatchImageID
	if req.Msg.ClearEyeCatchImage {
		eyeCatchImageID = uuid.NullUUID{}
	} else if len(eyeCatchVariants) > 0 {
		eyeCatchImageID, err = s.createGenreEyeCatchImage(txCtx, tenant, current.ID, current.PublicID, eyeCatchVariants)
		if err != nil {
			return nil, err
		}
	}
	if err := s.queriesFor(txCtx).UpdateGenre(txCtx, dbmodels.UpdateGenreParams{
		ID:              current.ID,
		Name:            normalized.name,
		Slug:            normalized.slug,
		EyeCatchImageID: eyeCatchImageID,
	}); err != nil {
		if dberr.IsUniqueViolation(err) {
			return nil, existingGenreNameError()
		}
		return nil, s.internalDBError(ctx, "failed to update genre", err, "tenant_id", tenant.ID.String(), "genre_id", current.ID.String())
	}
	owed, err := s.recordRevalidation(txCtx, tenant.ID, genreRevalidateTags(tenant.ID.String()))
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to record the cache invalidation for the updated genre", err, "tenant_id", tenant.ID.String(), "genre_id", current.ID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit update genre", err, "tenant_id", tenant.ID.String(), "genre_id", current.ID.String())
	}
	s.reval.Send(ctx, owed)

	s.recordGenreChange(ctx, tenant.ID, req.Header(), "genre_updated", current.PublicID)

	genre, err := s.genreWithEyeCatch(ctx, tenant.ID, current.PublicID)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&publiraadminv1.UpdateGenreResponse{Genre: genre}), nil
}

func (s *adminServer) ReorderGenres(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ReorderGenresRequest],
) (*connect.Response[publiraadminv1.ReorderGenresResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if err := validateDistinctPublicIDs(req.Msg.GenrePublicIds, "genre_public_ids", "genre"); err != nil {
		return nil, err
	}
	if err := validateDistinctPublicIDs(req.Msg.ExpectedGenrePublicIds, "expected_genre_public_ids", "genre"); err != nil {
		return nil, err
	}
	if !samePublicIDSet(req.Msg.GenrePublicIds, req.Msg.ExpectedGenrePublicIds) {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("genre_public_ids must be a permutation of expected_genre_public_ids"))
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin reorder genres transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	txCtx := rpcmiddleware.WithTenantQueries(ctx, dbmodels.New(tx))
	// Locking every genre of the tenant is what makes the comparison below
	// mean something: no concurrent write can add, remove, or move one between
	// the check and the write.
	locked, err := s.queriesFor(txCtx).LockGenresForTenant(txCtx, tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to lock genres for reorder", err, "tenant_id", tenant.ID.String())
	}
	byPublicID := make(map[string]dbmodels.LockGenresForTenantRow, len(locked))
	currentOrder := make([]string, 0, len(locked))
	for _, row := range locked {
		byPublicID[row.PublicID] = row
		currentOrder = append(currentOrder, row.PublicID)
	}
	if !slices.Equal(currentOrder, req.Msg.ExpectedGenrePublicIds) {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("genre order has changed"))
	}

	reordered := make([]genreRow, 0, len(req.Msg.GenrePublicIds))
	for index, publicID := range req.Msg.GenrePublicIds {
		row := byPublicID[publicID]
		if err := s.queriesFor(txCtx).UpdateGenreDisplayOrder(txCtx, dbmodels.UpdateGenreDisplayOrderParams{
			ID:           row.ID,
			DisplayOrder: int32(index + 1),
		}); err != nil {
			return nil, s.internalDBError(ctx, "failed to update genre display order", err, "tenant_id", tenant.ID.String(), "genre_id", row.ID.String())
		}
		reordered = append(reordered, genreRow{
			publicID:               row.PublicID,
			name:                   row.Name,
			slug:                   row.Slug,
			eyeCatchImageID:        row.EyeCatchImageID,
			eyeCatchImageUpdatedAt: row.EyeCatchImageUpdatedAt,
		})
	}
	owed, err := s.recordRevalidation(txCtx, tenant.ID, genreRevalidateTags(tenant.ID.String()))
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to record the cache invalidation for the genre order", err, "tenant_id", tenant.ID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit reorder genres", err, "tenant_id", tenant.ID.String())
	}
	s.reval.Send(ctx, owed)

	s.recordGenreChange(ctx, tenant.ID, req.Header(), "genres_reordered", tenant.PublicID)

	genres, err := s.genreMessages(ctx, reordered)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&publiraadminv1.ReorderGenresResponse{Genres: genres}), nil
}

func (s *adminServer) DeleteGenre(
	ctx context.Context,
	req *connect.Request[publiraadminv1.DeleteGenreRequest],
) (*connect.Response[publiraadminv1.DeleteGenreResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	current, err := s.genreByPublicID(ctx, tenant.ID, req.Msg.PublicId)
	if err != nil {
		return nil, err
	}
	assigned, err := s.queriesFor(ctx).CountSeriesByGenreIDForTenant(ctx, dbmodels.CountSeriesByGenreIDForTenantParams{
		TenantID: tenant.ID,
		GenreID:  current.ID,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to count series of a genre", err, "tenant_id", tenant.ID.String(), "genre_id", current.ID.String())
	}
	if assigned > 0 {
		return nil, genreInUseError(assigned)
	}
	if err := s.queriesFor(ctx).DeleteGenre(ctx, current.ID); err != nil {
		// A series can take the genre between the count and the delete. The
		// foreign key is what actually holds the line, so its refusal is
		// reported as the same failed precondition rather than as a fault.
		if dberr.IsForeignKeyViolation(err) {
			return nil, genreInUseError(1)
		}
		return nil, s.internalDBError(ctx, "failed to delete genre", err, "tenant_id", tenant.ID.String(), "genre_id", current.ID.String())
	}

	s.recordGenreChange(ctx, tenant.ID, req.Header(), "genre_deleted", current.PublicID)
	s.revalidateTags(ctx, tenant.ID, genreRevalidateTags(tenant.ID.String()))

	return connect.NewResponse(&publiraadminv1.DeleteGenreResponse{}), nil
}

// genreInUseError refuses to delete a genre a series still carries. Deleting it
// would reclassify those series without anyone saying so, so the count is part
// of the message: it tells the editor how much work unassigning it is.
func genreInUseError(assigned int32) error {
	return connect.NewError(
		connect.CodeFailedPrecondition,
		fmt.Errorf("genre is assigned to %d series and cannot be deleted", assigned),
	)
}

func (s *adminServer) genreByPublicID(ctx context.Context, tenantID uuid.UUID, publicID string) (dbmodels.GetGenreByPublicIDForTenantRow, error) {
	row, err := s.queriesFor(ctx).GetGenreByPublicIDForTenant(ctx, dbmodels.GetGenreByPublicIDForTenantParams{
		TenantID: tenantID,
		PublicID: strings.TrimSpace(publicID),
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dbmodels.GetGenreByPublicIDForTenantRow{}, connect.NewError(connect.CodeNotFound, errors.New("genre not found"))
		}
		return dbmodels.GetGenreByPublicIDForTenantRow{}, s.internalDBError(ctx, "failed to get genre", err, "tenant_id", tenantID.String(), "genre_public_id", publicID)
	}
	return row, nil
}
