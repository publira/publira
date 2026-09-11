package adminapi

import (
	"cmp"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	_ "golang.org/x/image/webp"

	"github.com/publira/publira/server/api/protomapper"
	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/imageproc"
	"github.com/publira/publira/server/internal/pagination"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/publicid"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/storage"
)

func parsePublishedAtOrZero(value string) (sql.NullTime, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return sql.NullTime{}, nil
	}
	t, err := time.Parse(time.RFC3339, trimmed)
	if err != nil {
		return sql.NullTime{}, connect.NewError(connect.CodeInvalidArgument, errors.New("published_at must be RFC3339"))
	}
	return sql.NullTime{Time: t.UTC(), Valid: true}, nil
}

type normalizedEyeCatchImage struct {
	ContentType string
	Data        []byte
}

// normalizeEyeCatchImage accepts an eye-catch upload and reports the content
// type to store it under, or nil when the request carried no image. The field
// names are arguments because the same checks guard both the whole-eye-catch
// image on the create/update requests and the per-ratio image on its own RPC.
func normalizeEyeCatchImage(data []byte, contentType, dataField, contentTypeField string) (*normalizedEyeCatchImage, error) {
	if len(data) == 0 {
		return nil, nil
	}
	if len(data) > imageproc.EyeCatchMaxBytes {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, fmt.Errorf("%s exceeds 10MB", dataField), dataField)
	}

	normalizedContentType := strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	if normalizedContentType == "" {
		normalizedContentType = strings.ToLower(strings.TrimSpace(http.DetectContentType(data)))
	}
	if normalizedContentType != "image/jpeg" && normalizedContentType != "image/png" && normalizedContentType != "image/webp" {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, fmt.Errorf("%s must be image/jpeg, image/png, or image/webp", contentTypeField), contentTypeField)
	}

	return &normalizedEyeCatchImage{
		ContentType: normalizedContentType,
		Data:        data,
	}, nil
}

func normalizeSeriesEyeCatchImage(data []byte, contentType string) (*normalizedEyeCatchImage, error) {
	return normalizeEyeCatchImage(data, contentType, "eye_catch_image_data", "eye_catch_image_content_type")
}

func (s *adminServer) createSeriesEyeCatchImage(ctx context.Context, tenant dbmodels.Tenant, seriesID uuid.UUID, seriesPublicID string, img *normalizedEyeCatchImage) (uuid.NullUUID, error) {
	if img == nil {
		return uuid.NullUUID{}, nil
	}
	if s.storage == nil {
		return uuid.NullUUID{}, connect.NewError(connect.CodeInternal, errors.New("storage provider is not configured"))
	}

	seriesImageID, err := uuid.NewV7()
	if err != nil {
		return uuid.NullUUID{}, connect.NewError(connect.CodeInternal, err)
	}

	createdImage, err := s.queriesFor(ctx).CreateSeriesImage(ctx, dbmodels.CreateSeriesImageParams{
		ID:       seriesImageID,
		TenantID: tenant.ID,
		SeriesID: seriesID,
	})
	if err != nil {
		return uuid.NullUUID{}, s.internalDBError(ctx, "failed to create series image", err, "tenant_id", tenant.ID.String(), "series_id", seriesID.String())
	}

	variants, err := imageproc.BuildEyeCatchVariants(img.Data, img.ContentType)
	if err != nil {
		return uuid.NullUUID{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "eye_catch_image_data")
	}

	for _, variant := range variants {
		objectKey := fmt.Sprintf(
			"tenants/%s/series/%s/%s-%s%s",
			tenant.PublicID,
			seriesPublicID,
			createdImage.ID.String(),
			variant.Label,
			variant.Extension,
		)
		uploaded, uploadErr := s.storage.Upload(ctx, storage.UploadRequest{
			ObjectKey:   objectKey,
			ContentType: variant.ContentType,
			Data:        variant.Data,
		})
		if uploadErr != nil {
			return uuid.NullUUID{}, storageUploadError(uploadErr)
		}

		seriesImageVariantID, variantIDErr := uuid.NewV7()
		if variantIDErr != nil {
			return uuid.NullUUID{}, connect.NewError(connect.CodeInternal, variantIDErr)
		}

		_, createVariantErr := s.queriesFor(ctx).CreateSeriesImageVariant(ctx, dbmodels.CreateSeriesImageVariantParams{
			ID:              seriesImageVariantID,
			TenantID:        tenant.ID,
			SeriesImageID:   createdImage.ID,
			VariantType:     variant.VariantType,
			Label:           variant.Label,
			StorageProvider: uploaded.Provider,
			ObjectKey:       uploaded.ObjectKey,
			ContentType:     variant.ContentType,
			FileSizeBytes:   uploaded.SizeBytes,
			Width:           int32(variant.Width),
			Height:          int32(variant.Height),
		})
		if createVariantErr != nil {
			return uuid.NullUUID{}, s.internalDBError(ctx, "failed to create series image variant", createVariantErr, "tenant_id", tenant.ID.String(), "series_image_id", createdImage.ID.String())
		}
	}

	return uuid.NullUUID{UUID: createdImage.ID, Valid: true}, nil
}

func mapSeriesEyeCatchVariants(seriesImageID uuid.UUID, rows []dbmodels.ListSeriesImageVariantsByImageIDsRow) []*publirattypesv1.SeriesEyeCatchVariant {
	items := make([]*publirattypesv1.SeriesEyeCatchVariant, 0, len(rows))
	for _, row := range rows {
		items = append(items, &publirattypesv1.SeriesEyeCatchVariant{
			Label:         row.Label,
			VariantType:   row.VariantType,
			Url:           fmt.Sprintf("/images/series/%s/%s/%d", seriesImageID.String(), row.VariantType, row.Width),
			ContentType:   row.ContentType,
			Width:         row.Width,
			Height:        row.Height,
			FileSizeBytes: row.FileSizeBytes,
		})
	}
	return items
}

func (s *adminServer) seriesEyeCatchVariantsByImageIDs(
	ctx context.Context,
	imageIDs []uuid.UUID,
) (map[uuid.UUID][]*publirattypesv1.SeriesEyeCatchVariant, error) {
	if len(imageIDs) == 0 {
		return map[uuid.UUID][]*publirattypesv1.SeriesEyeCatchVariant{}, nil
	}

	rows, err := s.queriesFor(ctx).ListSeriesImageVariantsByImageIDs(ctx, imageIDs)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list series image variants", err)
	}

	byImageID := make(map[uuid.UUID][]dbmodels.ListSeriesImageVariantsByImageIDsRow, len(imageIDs))
	for _, row := range rows {
		byImageID[row.SeriesImageID] = append(byImageID[row.SeriesImageID], row)
	}

	mapped := make(map[uuid.UUID][]*publirattypesv1.SeriesEyeCatchVariant, len(byImageID))
	for imageID, variants := range byImageID {
		mapped[imageID] = mapSeriesEyeCatchVariants(imageID, variants)
	}

	return mapped, nil
}

// syncSeriesCredits writes the whole credit list of a series. replace is false
// on create, where there is nothing to clear first.
//
// display_order is the position in the request, which orders the creators who
// share a role: the read sorts by role priority first, so a global index keeps
// the order the editor gave within each role without carrying a second
// counter.
func (s *adminServer) syncSeriesCredits(
	ctx context.Context,
	tenantID, seriesID uuid.UUID,
	credits []creatorCredit,
	replace bool,
) ([]*publirattypesv1.Creator, error) {
	if replace {
		if err := s.queriesFor(ctx).DeleteSeriesCreatorsBySeriesID(ctx, seriesID); err != nil {
			return nil, s.internalDBError(ctx, "failed to delete series creators", err, "tenant_id", tenantID.String(), "series_id", seriesID.String())
		}
	}
	ordered := slices.SortedStableFunc(slices.Values(credits), func(left, right creatorCredit) int {
		return cmp.Compare(left.role.DisplayPriority, right.role.DisplayPriority)
	})
	items := make([]*publirattypesv1.Creator, 0, len(ordered))
	for index, credit := range ordered {
		err := s.queriesFor(ctx).CreateSeriesCreator(ctx, dbmodels.CreateSeriesCreatorParams{
			TenantID:     tenantID,
			SeriesID:     seriesID,
			CreatorID:    credit.creator.ID,
			RoleID:       credit.role.ID,
			DisplayOrder: int32(index),
		})
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to create series creator", err, "tenant_id", tenantID.String(), "series_id", seriesID.String(), "creator_id", credit.creator.ID.String())
		}
		items = append(items, &publirattypesv1.Creator{
			PublicId:    credit.creator.PublicID,
			Name:        credit.creator.Name,
			ProfileText: credit.creator.ProfileText.String,
			Role: &publirattypesv1.CreatorRole{
				PublicId: credit.role.PublicID,
				Name:     credit.role.Name,
			},
		})
	}
	return items, nil
}

func (s *adminServer) seriesCreatorsBySeriesIDs(
	ctx context.Context,
	seriesIDs []uuid.UUID,
) (map[uuid.UUID][]*publirattypesv1.Creator, error) {
	if len(seriesIDs) == 0 {
		return map[uuid.UUID][]*publirattypesv1.Creator{}, nil
	}
	rows, err := s.queriesFor(ctx).ListSeriesCreatorsBySeriesIDs(ctx, seriesIDs)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list series creators", err)
	}
	items := make(map[uuid.UUID][]*publirattypesv1.Creator, len(seriesIDs))
	for _, row := range rows {
		creator := &publirattypesv1.Creator{
			PublicId: row.PublicID,
			Name:     row.Name,
		}
		// A credit written before roles existed carries none, and says so by
		// leaving the field unset rather than by naming an empty role.
		if row.RolePublicID.Valid {
			creator.Role = &publirattypesv1.CreatorRole{
				PublicId: row.RolePublicID.String,
				Name:     row.RoleName.String,
			}
		}
		items[row.SeriesID] = append(items[row.SeriesID], creator)
	}
	return items, nil
}

// maxSeriesTags bounds how many tags one series carries. Tags exist to group
// series, and a series wearing more labels than a reader can take in groups it
// with everything and therefore with nothing.
const maxSeriesTags = 20

// resolveGenresByPublicIDs reads the genres a save assigned, in the tenant's
// genre order. A public_id naming no genre of this tenant is a bad request
// rather than a silently dropped assignment.
func (s *adminServer) resolveGenresByPublicIDs(
	ctx context.Context,
	tenantID uuid.UUID,
	genrePublicIDs []string,
) ([]dbmodels.ListGenresByPublicIDsForTenantRow, error) {
	normalized := make([]string, 0, len(genrePublicIDs))
	seen := make(map[string]struct{}, len(genrePublicIDs))
	for _, value := range genrePublicIDs {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("genre_public_ids contains empty value"), "genre_public_ids")
		}
		if _, ok := seen[trimmed]; ok {
			return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("genre_public_ids contains duplicate value"), "genre_public_ids")
		}
		seen[trimmed] = struct{}{}
		normalized = append(normalized, trimmed)
	}
	if len(normalized) == 0 {
		return []dbmodels.ListGenresByPublicIDsForTenantRow{}, nil
	}
	rows, err := s.queriesFor(ctx).ListGenresByPublicIDsForTenant(ctx, dbmodels.ListGenresByPublicIDsForTenantParams{
		TenantID:  tenantID,
		PublicIds: normalized,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list genres by public ids", err, "tenant_id", tenantID.String())
	}
	if len(rows) != len(normalized) {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("genre not found"), "genre_public_ids")
	}
	return rows, nil
}

// syncSeriesGenres writes the whole genre assignment of a series. replace is
// false only on create, where there is nothing to clear.
func (s *adminServer) syncSeriesGenres(
	ctx context.Context,
	tenantID, seriesID uuid.UUID,
	genres []dbmodels.ListGenresByPublicIDsForTenantRow,
	replace bool,
) ([]*publirattypesv1.Genre, error) {
	if replace {
		if err := s.queriesFor(ctx).DeleteSeriesGenresBySeriesID(ctx, seriesID); err != nil {
			return nil, s.internalDBError(ctx, "failed to delete series genres", err, "tenant_id", tenantID.String(), "series_id", seriesID.String())
		}
	}
	items := make([]*publirattypesv1.Genre, 0, len(genres))
	for _, genre := range genres {
		if err := s.queriesFor(ctx).CreateSeriesGenre(ctx, dbmodels.CreateSeriesGenreParams{
			TenantID: tenantID,
			SeriesID: seriesID,
			GenreID:  genre.ID,
		}); err != nil {
			return nil, s.internalDBError(ctx, "failed to create series genre", err, "tenant_id", tenantID.String(), "series_id", seriesID.String(), "genre_id", genre.ID.String())
		}
		items = append(items, &publirattypesv1.Genre{PublicId: genre.PublicID, Name: genre.Name, Slug: genre.Slug})
	}
	return items, nil
}

// normalizeTagNames turns what the editor typed into the tags to store: each
// name trimmed and slugged, and two names that share a slug counted once, so
// "Fantasy" alongside "fantasy" is one tag rather than a rejected save.
func normalizeTagNames(names []string) ([]normalizedCatalogName, error) {
	tags := make([]normalizedCatalogName, 0, len(names))
	seen := make(map[string]struct{}, len(names))
	for _, name := range names {
		normalized, err := normalizeCatalogName(name, "tag_names")
		if err != nil {
			return nil, err
		}
		if _, ok := seen[normalized.slug]; ok {
			continue
		}
		seen[normalized.slug] = struct{}{}
		tags = append(tags, normalized)
	}
	if len(tags) > maxSeriesTags {
		return nil, rpcerrors.NewFieldViolationError(
			connect.CodeInvalidArgument,
			fmt.Errorf("tag_names must hold at most %d tags", maxSeriesTags),
			"tag_names",
		)
	}
	return tags, nil
}

// syncSeriesTags writes the whole tag assignment of a series, creating the tags
// being used for the first time and deleting the ones this series was the last
// to carry.
func (s *adminServer) syncSeriesTags(
	ctx context.Context,
	tenantID, seriesID uuid.UUID,
	tags []normalizedCatalogName,
	replace bool,
) ([]*publirattypesv1.Tag, error) {
	if replace {
		if err := s.queriesFor(ctx).DeleteSeriesTagsBySeriesID(ctx, seriesID); err != nil {
			return nil, s.internalDBError(ctx, "failed to delete series tags", err, "tenant_id", tenantID.String(), "series_id", seriesID.String())
		}
	}
	for _, tag := range tags {
		tagID, err := uuid.NewV7()
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
		stored, err := s.queriesFor(ctx).UpsertTagForTenant(ctx, dbmodels.UpsertTagForTenantParams{
			ID:       tagID,
			TenantID: tenantID,
			Name:     tag.name,
			Slug:     tag.slug,
		})
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to upsert tag", err, "tenant_id", tenantID.String(), "tag_slug", tag.slug)
		}
		if err := s.queriesFor(ctx).CreateSeriesTag(ctx, dbmodels.CreateSeriesTagParams{
			TenantID: tenantID,
			SeriesID: seriesID,
			TagID:    stored.ID,
		}); err != nil {
			return nil, s.internalDBError(ctx, "failed to create series tag", err, "tenant_id", tenantID.String(), "series_id", seriesID.String(), "tag_id", stored.ID.String())
		}
	}
	if replace {
		// The links this save removed may have been the last ones a tag had.
		// Nothing else keeps a tag alive, so it goes with them — but only after
		// the candidates are locked and re-checked, which is what keeps a save
		// committing alongside this one from losing the tag it just took. The
		// reasoning is in db/query/tag.sql.
		unused, err := s.queriesFor(ctx).LockUnusedTagsForTenant(ctx, tenantID)
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to lock unused tags", err, "tenant_id", tenantID.String())
		}
		if len(unused) > 0 {
			if err := s.queriesFor(ctx).DeleteUnusedTagsByIDsForTenant(ctx, dbmodels.DeleteUnusedTagsByIDsForTenantParams{
				TenantID: tenantID,
				Ids:      unused,
			}); err != nil {
				return nil, s.internalDBError(ctx, "failed to delete unused tags", err, "tenant_id", tenantID.String())
			}
		}
	}
	if len(tags) == 0 {
		return []*publirattypesv1.Tag{}, nil
	}
	// Read the assignment back through the query the read path uses, so a save
	// answers with the names actually stored, in the order the next read will
	// hand them back — the database sorts them, and only it knows its own
	// collation.
	tagsBySeriesID, err := s.seriesTagsBySeriesIDs(ctx, []uuid.UUID{seriesID})
	if err != nil {
		return nil, err
	}
	items := tagsBySeriesID[seriesID]
	if items == nil {
		items = []*publirattypesv1.Tag{}
	}
	return items, nil
}

func (s *adminServer) seriesGenresBySeriesIDs(
	ctx context.Context,
	seriesIDs []uuid.UUID,
) (map[uuid.UUID][]*publirattypesv1.Genre, error) {
	if len(seriesIDs) == 0 {
		return map[uuid.UUID][]*publirattypesv1.Genre{}, nil
	}
	rows, err := s.queriesFor(ctx).ListSeriesGenresBySeriesIDs(ctx, seriesIDs)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list series genres", err)
	}
	items := make(map[uuid.UUID][]*publirattypesv1.Genre, len(seriesIDs))
	for _, row := range rows {
		items[row.SeriesID] = append(items[row.SeriesID], &publirattypesv1.Genre{
			PublicId: row.PublicID,
			Name:     row.Name,
			Slug:     row.Slug,
		})
	}
	return items, nil
}

func (s *adminServer) seriesTagsBySeriesIDs(
	ctx context.Context,
	seriesIDs []uuid.UUID,
) (map[uuid.UUID][]*publirattypesv1.Tag, error) {
	if len(seriesIDs) == 0 {
		return map[uuid.UUID][]*publirattypesv1.Tag{}, nil
	}
	rows, err := s.queriesFor(ctx).ListSeriesTagsBySeriesIDs(ctx, seriesIDs)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list series tags", err)
	}
	items := make(map[uuid.UUID][]*publirattypesv1.Tag, len(seriesIDs))
	for _, row := range rows {
		items[row.SeriesID] = append(items[row.SeriesID], &publirattypesv1.Tag{
			Name: row.Name,
			Slug: row.Slug,
		})
	}
	return items, nil
}

// seriesListingMetadata is the part of a series the tenant states about the
// series itself: whether it is still running, when a new episode is expected,
// and who it is meant for.
type seriesListingMetadata struct {
	status           string
	scheduleWeekdays []int32
	ageRating        string
	commentMode      sql.NullString
}

// normalizeSeriesListingMetadata validates the listing fields of a create or
// update request. An unspecified enum stores the column's default, so a client
// that does not carry these fields yet keeps saving series the way it did — and
// for the comment mode that default is no value at all, which is the series
// following whatever its tenant has chosen.
func normalizeSeriesListingMetadata(
	status publirattypesv1.SeriesStatus,
	scheduleWeekdays []int32,
	ageRating publirattypesv1.SeriesAgeRating,
	commentMode publirattypesv1.CommentMode,
) (seriesListingMetadata, error) {
	storedStatus, err := protomapper.SeriesStatusToStored(status)
	if err != nil {
		return seriesListingMetadata{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "status")
	}
	storedWeekdays, err := protomapper.ScheduleWeekdaysToStored(scheduleWeekdays)
	if err != nil {
		return seriesListingMetadata{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "schedule_weekdays")
	}
	storedAgeRating, err := protomapper.SeriesAgeRatingToStored(ageRating)
	if err != nil {
		return seriesListingMetadata{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "age_rating")
	}
	storedCommentMode, err := protomapper.CommentModeOverrideToStored(commentMode)
	if err != nil {
		return seriesListingMetadata{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "comment_mode")
	}
	return seriesListingMetadata{
		status:           storedStatus,
		scheduleWeekdays: storedWeekdays,
		ageRating:        storedAgeRating,
		commentMode:      storedCommentMode,
	}, nil
}

func seriesRevalidateTags(tenantID, seriesPublicID string) []string {
	normalizedTenantID := strings.TrimSpace(tenantID)
	normalizedSeriesPublicID := strings.TrimSpace(seriesPublicID)
	return []string{
		fmt.Sprintf("tenant:%s:site", normalizedTenantID),
		fmt.Sprintf("tenant:%s:series:list", normalizedTenantID),
		fmt.Sprintf("tenant:%s:series:detail", normalizedTenantID),
		fmt.Sprintf("tenant:%s:series:%s", normalizedTenantID, normalizedSeriesPublicID),
		fmt.Sprintf("tenant:%s:creators", normalizedTenantID),
	}
}

func (s *adminServer) CreateSeries(
	ctx context.Context,
	req *connect.Request[publiraadminv1.CreateSeriesRequest],
) (*connect.Response[publiraadminv1.CreateSeriesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Msg.Title) == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("title is required"))
	}
	if req.Msg.ReadingPeriodHours < 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("reading_period_hours must be greater than or equal to 0"))
	}
	eyeCatchImage, err := normalizeSeriesEyeCatchImage(req.Msg.EyeCatchImageData, req.Msg.EyeCatchImageContentType)
	if err != nil {
		return nil, err
	}
	listingMetadata, err := normalizeSeriesListingMetadata(req.Msg.Status, req.Msg.ScheduleWeekdays, req.Msg.AgeRating, req.Msg.CommentMode)
	if err != nil {
		return nil, err
	}
	publishedAt, err := parsePublishedAtOrZero(req.Msg.PublishedAt)
	if err != nil {
		return nil, err
	}
	if !publishedAt.Valid && req.Msg.IsPublished {
		publishedAt = sql.NullTime{Time: time.Now().UTC(), Valid: true}
	}
	labelID := uuid.NullUUID{}
	if strings.TrimSpace(req.Msg.LabelPublicId) != "" {
		label, err := s.queriesFor(ctx).GetLabelByPublicIDForTenant(ctx, dbmodels.GetLabelByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.LabelPublicId})
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("label not found"))
			}
			return nil, s.internalDBError(ctx, "failed to get label for create series", err, "tenant_id", tenant.ID.String(), "label_public_id", req.Msg.LabelPublicId)
		}
		labelID = uuid.NullUUID{UUID: label.ID, Valid: true}
	}
	creditsToLink, err := s.resolveCreatorCredits(ctx, tenant.ID, creatorCreditPairs(req.Msg.CreatorCredits))
	if err != nil {
		return nil, err
	}
	genresToLink, err := s.resolveGenresByPublicIDs(ctx, tenant.ID, req.Msg.GenrePublicIds)
	if err != nil {
		return nil, err
	}
	tagsToLink, err := normalizeTagNames(req.Msg.TagNames)
	if err != nil {
		return nil, err
	}
	seriesID, err := uuid.NewV7()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin create series transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	txCtx := rpcmiddleware.WithTenantQueries(ctx, dbmodels.New(tx))
	base, err := publicid.InsertTx(txCtx, tx, func(publicID string) (dbmodels.Series, error) {
		return s.queriesFor(txCtx).CreateSeriesBase(txCtx, dbmodels.CreateSeriesBaseParams{
			ID: seriesID, TenantID: tenant.ID, LabelID: labelID, PublicID: publicID, Title: req.Msg.Title,
		})
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to create series", err, "tenant_id", tenant.ID.String())
	}
	_, err = s.queriesFor(txCtx).UpsertSeriesListing(txCtx, dbmodels.UpsertSeriesListingParams{
		TenantID:           tenant.ID,
		SeriesID:           base.ID,
		Synopsis:           sql.NullString{String: req.Msg.Synopsis, Valid: strings.TrimSpace(req.Msg.Synopsis) != ""},
		ReadingPeriodHours: sql.NullInt32{Int32: req.Msg.ReadingPeriodHours, Valid: req.Msg.ReadingPeriodHours > 0},
		Status:             listingMetadata.status,
		ScheduleWeekdays:   listingMetadata.scheduleWeekdays,
		AgeRating:          listingMetadata.ageRating,
		CommentMode:        listingMetadata.commentMode,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to upsert series listing", err, "tenant_id", tenant.ID.String(), "series_id", base.ID.String())
	}
	err = s.queriesFor(txCtx).UpdateSeriesPublication(txCtx, dbmodels.UpdateSeriesPublicationParams{
		ID:          base.ID,
		PublishedAt: publishedAt,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to update series publication", err, "tenant_id", tenant.ID.String(), "series_id", base.ID.String())
	}
	eyeCatchImageID, err := s.createSeriesEyeCatchImage(txCtx, tenant, base.ID, base.PublicID, eyeCatchImage)
	if err != nil {
		return nil, err
	}
	if eyeCatchImageID.Valid {
		if err := s.queriesFor(txCtx).UpdateSeriesEyeCatchImageID(txCtx, dbmodels.UpdateSeriesEyeCatchImageIDParams{
			ID:              base.ID,
			EyeCatchImageID: eyeCatchImageID,
		}); err != nil {
			return nil, s.internalDBError(ctx, "failed to update series eye catch image", err, "tenant_id", tenant.ID.String(), "series_id", base.ID.String())
		}
	}
	creators, err := s.syncSeriesCredits(txCtx, tenant.ID, base.ID, creditsToLink, false)
	if err != nil {
		return nil, err
	}
	genres, err := s.syncSeriesGenres(txCtx, tenant.ID, base.ID, genresToLink, false)
	if err != nil {
		return nil, err
	}
	tags, err := s.syncSeriesTags(txCtx, tenant.ID, base.ID, tagsToLink, false)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit create series", err, "tenant_id", tenant.ID.String(), "series_id", base.ID.String())
	}
	if sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx); ok {
		s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
			TenantID:    tenant.ID,
			ActorUserID: sessionCtx.User.ID,
			ActorRole:   sessionCtx.Role,
			Action:      "series_created",
			TargetType:  "series",
			TargetID:    base.PublicID,
			Outcome:     auditlog.OutcomeSuccess,
			ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
		})
	}
	if publishedAt.Valid && !publishedAt.Time.After(time.Now().UTC()) && s.reval != nil {
		if err := s.reval.RevalidateTags(ctx, seriesRevalidateTags(tenant.ID.String(), base.PublicID)); err != nil {
			s.logger.Warn("failed to request next revalidate after series create", "tenant_public_id", tenant.PublicID, "series_public_id", base.PublicID, "error", err)
		}
	}
	created, err := s.queriesFor(ctx).GetSeriesByPublicIDForTenant(ctx, dbmodels.GetSeriesByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: base.PublicID})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get created series", err, "tenant_id", tenant.ID.String(), "series_id", base.ID.String())
	}
	series, err := protomapper.SeriesFromGetSeriesByPublicIDForTenantRow(created)
	if err != nil {
		return nil, s.internalError(ctx, "series listing holds a value this build does not know", err, "tenant_id", tenant.ID.String(), "series_public_id", created.PublicID)
	}
	if created.EyeCatchImageID.Valid {
		variantsByImageID, variantErr := s.seriesEyeCatchVariantsByImageIDs(ctx, []uuid.UUID{created.EyeCatchImageID.UUID})
		if variantErr != nil {
			return nil, variantErr
		}
		series.EyeCatchImageVariants = variantsByImageID[created.EyeCatchImageID.UUID]
	}
	series.Creators = creators
	series.Genres = genres
	series.Tags = tags
	commentMode, err := protomapper.CommentModeOverrideFromStored(created.CommentMode)
	if err != nil {
		return nil, s.internalError(ctx, "series listing holds a value this build does not know", err, "tenant_id", tenant.ID.String(), "series_public_id", created.PublicID)
	}
	return connect.NewResponse(&publiraadminv1.CreateSeriesResponse{Series: series, CommentMode: commentMode}), nil
}

func (s *adminServer) UpdateSeries(
	ctx context.Context,
	req *connect.Request[publiraadminv1.UpdateSeriesRequest],
) (*connect.Response[publiraadminv1.UpdateSeriesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Msg.Title) == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("title is required"))
	}
	if req.Msg.ReadingPeriodHours < 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("reading_period_hours must be greater than or equal to 0"))
	}
	if req.Msg.ClearEyeCatchImage && len(req.Msg.EyeCatchImageData) > 0 {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("clear_eye_catch_image and eye_catch_image_data cannot be used together"), "eye_catch_image_data")
	}
	listingMetadata, err := normalizeSeriesListingMetadata(req.Msg.Status, req.Msg.ScheduleWeekdays, req.Msg.AgeRating, req.Msg.CommentMode)
	if err != nil {
		return nil, err
	}
	eyeCatchImage, err := normalizeSeriesEyeCatchImage(req.Msg.EyeCatchImageData, req.Msg.EyeCatchImageContentType)
	if err != nil {
		return nil, err
	}
	publishedAt, err := parsePublishedAtOrZero(req.Msg.PublishedAt)
	if err != nil {
		return nil, err
	}
	if !publishedAt.Valid && req.Msg.IsPublished {
		publishedAt = sql.NullTime{Time: time.Now().UTC(), Valid: true}
	}
	current, err := s.queriesFor(ctx).GetSeriesByPublicIDForTenant(ctx, dbmodels.GetSeriesByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.PublicId})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("series not found"))
		}
		return nil, s.internalDBError(ctx, "failed to get series for update", err, "tenant_id", tenant.ID.String(), "series_public_id", req.Msg.PublicId)
	}
	labelPublicID := strings.TrimSpace(req.Msg.LabelPublicId)
	if labelPublicID == "" && current.LabelPublicID.Valid {
		labelPublicID = current.LabelPublicID.String
	}
	labelID := uuid.NullUUID{}
	if labelPublicID != "" {
		label, err := s.queriesFor(ctx).GetLabelByPublicIDForTenant(ctx, dbmodels.GetLabelByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: labelPublicID})
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("label not found"))
			}
			return nil, s.internalDBError(ctx, "failed to get label for update series", err, "tenant_id", tenant.ID.String(), "label_public_id", labelPublicID)
		}
		labelID = uuid.NullUUID{UUID: label.ID, Valid: true}
	}
	creditsToLink, err := s.resolveCreatorCredits(ctx, tenant.ID, creatorCreditPairs(req.Msg.CreatorCredits))
	if err != nil {
		return nil, err
	}
	genresToLink, err := s.resolveGenresByPublicIDs(ctx, tenant.ID, req.Msg.GenrePublicIds)
	if err != nil {
		return nil, err
	}
	tagsToLink, err := normalizeTagNames(req.Msg.TagNames)
	if err != nil {
		return nil, err
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin update series transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	txCtx := rpcmiddleware.WithTenantQueries(ctx, dbmodels.New(tx))
	err = s.queriesFor(txCtx).UpdateSeriesBase(txCtx, dbmodels.UpdateSeriesBaseParams{ID: current.ID, Title: req.Msg.Title, LabelID: labelID})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to update series", err, "tenant_id", tenant.ID.String(), "series_id", current.ID.String())
	}
	_, err = s.queriesFor(txCtx).UpsertSeriesListing(txCtx, dbmodels.UpsertSeriesListingParams{
		TenantID:           tenant.ID,
		SeriesID:           current.ID,
		Synopsis:           sql.NullString{String: req.Msg.Synopsis, Valid: strings.TrimSpace(req.Msg.Synopsis) != ""},
		ReadingPeriodHours: sql.NullInt32{Int32: req.Msg.ReadingPeriodHours, Valid: req.Msg.ReadingPeriodHours > 0},
		Status:             listingMetadata.status,
		ScheduleWeekdays:   listingMetadata.scheduleWeekdays,
		AgeRating:          listingMetadata.ageRating,
		CommentMode:        listingMetadata.commentMode,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to upsert series listing", err, "tenant_id", tenant.ID.String(), "series_id", current.ID.String())
	}
	err = s.queriesFor(txCtx).UpdateSeriesPublication(txCtx, dbmodels.UpdateSeriesPublicationParams{
		ID:          current.ID,
		PublishedAt: publishedAt,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to update series publication", err, "tenant_id", tenant.ID.String(), "series_id", current.ID.String())
	}
	eyeCatchImageID := current.EyeCatchImageID
	if req.Msg.ClearEyeCatchImage {
		eyeCatchImageID = uuid.NullUUID{}
	} else if eyeCatchImage != nil {
		newEyeCatchImageID, uploadErr := s.createSeriesEyeCatchImage(txCtx, tenant, current.ID, current.PublicID, eyeCatchImage)
		if uploadErr != nil {
			return nil, uploadErr
		}
		eyeCatchImageID = newEyeCatchImageID
	}
	if eyeCatchImageID != current.EyeCatchImageID {
		if err := s.queriesFor(txCtx).UpdateSeriesEyeCatchImageID(txCtx, dbmodels.UpdateSeriesEyeCatchImageIDParams{
			ID:              current.ID,
			EyeCatchImageID: eyeCatchImageID,
		}); err != nil {
			return nil, s.internalDBError(ctx, "failed to update series eye catch image", err, "tenant_id", tenant.ID.String(), "series_id", current.ID.String())
		}
	}
	creators, err := s.syncSeriesCredits(txCtx, tenant.ID, current.ID, creditsToLink, true)
	if err != nil {
		return nil, err
	}
	genres, err := s.syncSeriesGenres(txCtx, tenant.ID, current.ID, genresToLink, true)
	if err != nil {
		return nil, err
	}
	tags, err := s.syncSeriesTags(txCtx, tenant.ID, current.ID, tagsToLink, true)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit update series", err, "tenant_id", tenant.ID.String(), "series_id", current.ID.String())
	}
	updated, err := s.queriesFor(ctx).GetSeriesByPublicIDForTenant(ctx, dbmodels.GetSeriesByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.PublicId})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get updated series", err, "tenant_id", tenant.ID.String(), "series_id", current.ID.String())
	}
	if sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx); ok {
		s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
			TenantID:    tenant.ID,
			ActorUserID: sessionCtx.User.ID,
			ActorRole:   sessionCtx.Role,
			Action:      "series_updated",
			TargetType:  "series",
			TargetID:    current.PublicID,
			Outcome:     auditlog.OutcomeSuccess,
			ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
		})
	}
	if s.reval != nil {
		if current.IsPublished || (publishedAt.Valid && !publishedAt.Time.After(time.Now().UTC())) {
			if err := s.reval.RevalidateTags(ctx, seriesRevalidateTags(tenant.ID.String(), current.PublicID)); err != nil {
				s.logger.Warn("failed to request next revalidate after series update", "tenant_public_id", tenant.PublicID, "series_public_id", current.PublicID, "error", err)
			}
		}
	}
	series, err := protomapper.SeriesFromGetSeriesByPublicIDForTenantRow(updated)
	if err != nil {
		return nil, s.internalError(ctx, "series listing holds a value this build does not know", err, "tenant_id", tenant.ID.String(), "series_public_id", updated.PublicID)
	}
	if updated.EyeCatchImageID.Valid {
		variantsByImageID, variantErr := s.seriesEyeCatchVariantsByImageIDs(ctx, []uuid.UUID{updated.EyeCatchImageID.UUID})
		if variantErr != nil {
			return nil, variantErr
		}
		series.EyeCatchImageVariants = variantsByImageID[updated.EyeCatchImageID.UUID]
	}
	series.Creators = creators
	series.Genres = genres
	series.Tags = tags
	commentMode, err := protomapper.CommentModeOverrideFromStored(updated.CommentMode)
	if err != nil {
		return nil, s.internalError(ctx, "series listing holds a value this build does not know", err, "tenant_id", tenant.ID.String(), "series_public_id", updated.PublicID)
	}
	return connect.NewResponse(&publiraadminv1.UpdateSeriesResponse{Series: series, CommentMode: commentMode}), nil
}

const (
	defaultSeriesPageSize = int32(20)
	maxSeriesPageSize     = int32(100)
)

// seriesPageRow is one row of an admin series page, shared by the descending
// and ascending keyset queries so the handler reads a single shape.
type seriesPageRow struct {
	id                     uuid.UUID
	publicID               string
	title                  string
	labelPublicID          sql.NullString
	labelName              sql.NullString
	synopsis               sql.NullString
	readingPeriodHours     sql.NullInt32
	status                 sql.NullString
	scheduleWeekdays       []int32
	ageRating              sql.NullString
	isPublished            bool
	publishedAt            sql.NullTime
	createdAt              time.Time
	eyeCatchImageID        uuid.NullUUID
	eyeCatchImageUpdatedAt sql.NullTime
}

func mapSeriesDescRows(rows []dbmodels.ListSeriesByTenantDescRow) []seriesPageRow {
	mapped := make([]seriesPageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, seriesPageRow{
			id:                     row.ID,
			publicID:               row.PublicID,
			title:                  row.Title,
			labelPublicID:          row.LabelPublicID,
			labelName:              row.LabelName,
			synopsis:               row.Synopsis,
			readingPeriodHours:     row.ReadingPeriodHours,
			status:                 row.Status,
			scheduleWeekdays:       row.ScheduleWeekdays,
			ageRating:              row.AgeRating,
			isPublished:            row.IsPublished,
			publishedAt:            row.PublishedAt,
			createdAt:              row.CreatedAt,
			eyeCatchImageID:        row.EyeCatchImageID,
			eyeCatchImageUpdatedAt: row.EyeCatchImageUpdatedAt,
		})
	}
	return mapped
}

func mapSeriesAscRows(rows []dbmodels.ListSeriesByTenantAscRow) []seriesPageRow {
	mapped := make([]seriesPageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, seriesPageRow{
			id:                     row.ID,
			publicID:               row.PublicID,
			title:                  row.Title,
			labelPublicID:          row.LabelPublicID,
			labelName:              row.LabelName,
			synopsis:               row.Synopsis,
			readingPeriodHours:     row.ReadingPeriodHours,
			status:                 row.Status,
			scheduleWeekdays:       row.ScheduleWeekdays,
			ageRating:              row.AgeRating,
			isPublished:            row.IsPublished,
			publishedAt:            row.PublishedAt,
			createdAt:              row.CreatedAt,
			eyeCatchImageID:        row.EyeCatchImageID,
			eyeCatchImageUpdatedAt: row.EyeCatchImageUpdatedAt,
		})
	}
	return mapped
}

// seriesPage runs the keyset query for one page. The list reads newest first, so
// a backward page is scanned by the ascending query and put back into display
// order by pagination.Page.
func (s *adminServer) seriesPage(
	ctx context.Context,
	tenantID uuid.UUID,
	keys pagination.TimeUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]seriesPageRow, error) {
	queries := s.queriesFor(ctx)
	if direction == pagination.Backward {
		rows, err := queries.ListSeriesByTenantAsc(ctx, dbmodels.ListSeriesByTenantAscParams{
			TenantID:        tenantID,
			CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
			CursorInclusive: keys.Inclusive,
			CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
			Limit:           limit,
		})
		if err != nil {
			return nil, err
		}
		return mapSeriesAscRows(rows), nil
	}

	rows, err := queries.ListSeriesByTenantDesc(ctx, dbmodels.ListSeriesByTenantDescParams{
		TenantID:        tenantID,
		CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
		CursorInclusive: keys.Inclusive,
		CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
		Limit:           limit,
	})
	if err != nil {
		return nil, err
	}
	return mapSeriesDescRows(rows), nil
}

func (s *adminServer) ListSeries(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ListSeriesRequest],
) (*connect.Response[publiraadminv1.ListSeriesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultSeriesPageSize, maxSeriesPageSize)
	cursor, err := pagination.Decode(req.Msg.Token)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	}
	var keys pagination.TimeUUIDKeys
	if !cursor.IsZero() {
		keys, err = pagination.DecodeTimeUUID(cursor)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
		}
	}

	// One row past the page: its presence is what says another page exists.
	rows, err := s.seriesPage(ctx, tenant.ID, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list series", err, "tenant_id", tenant.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	items := make([]*publirattypesv1.Series, 0, len(rows))
	seriesIDs := make([]uuid.UUID, 0, len(rows))
	seriesImageIDs := make([]uuid.UUID, 0, len(rows))
	itemByID := make(map[uuid.UUID]*publirattypesv1.Series, len(rows))
	itemByImageID := make(map[uuid.UUID]*publirattypesv1.Series, len(rows))
	for _, row := range rows {
		item := &publirattypesv1.Series{
			PublicId:         row.publicID,
			Title:            row.title,
			IsPublished:      row.isPublished,
			ScheduleWeekdays: protomapper.ScheduleWeekdaysFromStored(row.scheduleWeekdays),
		}
		if row.labelPublicID.Valid {
			item.Label = protomapper.Label(row.labelPublicID.String, row.labelName.String)
		}
		if row.synopsis.Valid {
			item.Synopsis = row.synopsis.String
		}
		if row.readingPeriodHours.Valid {
			item.ReadingPeriodHours = row.readingPeriodHours.Int32
		}
		if row.status.Valid {
			status, statusErr := protomapper.SeriesStatusFromStored(row.status.String)
			if statusErr != nil {
				return nil, s.internalError(ctx, "series listing holds a value this build does not know", statusErr, "tenant_id", tenant.ID.String(), "series_public_id", row.publicID)
			}
			item.Status = status
		}
		if row.ageRating.Valid {
			ageRating, ageRatingErr := protomapper.SeriesAgeRatingFromStored(row.ageRating.String)
			if ageRatingErr != nil {
				return nil, s.internalError(ctx, "series listing holds a value this build does not know", ageRatingErr, "tenant_id", tenant.ID.String(), "series_public_id", row.publicID)
			}
			item.AgeRating = ageRating
		}
		if row.eyeCatchImageID.Valid {
			seriesImageIDs = append(seriesImageIDs, row.eyeCatchImageID.UUID)
			itemByImageID[row.eyeCatchImageID.UUID] = item
		}
		if row.eyeCatchImageUpdatedAt.Valid {
			item.EyeCatchImageUpdatedAt = row.eyeCatchImageUpdatedAt.Time.UTC().Format("2006-01-02T15:04:05Z07:00")
		}
		if row.publishedAt.Valid {
			item.PublishedAt = row.publishedAt.Time.UTC().Format(time.RFC3339)
		}
		seriesIDs = append(seriesIDs, row.id)
		itemByID[row.id] = item
		items = append(items, item)
	}
	creatorsBySeriesID, err := s.seriesCreatorsBySeriesIDs(ctx, seriesIDs)
	if err != nil {
		return nil, err
	}
	for seriesID, creators := range creatorsBySeriesID {
		if item, ok := itemByID[seriesID]; ok {
			item.Creators = creators
		}
	}
	genresBySeriesID, err := s.seriesGenresBySeriesIDs(ctx, seriesIDs)
	if err != nil {
		return nil, err
	}
	for seriesID, genres := range genresBySeriesID {
		if item, ok := itemByID[seriesID]; ok {
			item.Genres = genres
		}
	}
	tagsBySeriesID, err := s.seriesTagsBySeriesIDs(ctx, seriesIDs)
	if err != nil {
		return nil, err
	}
	for seriesID, tags := range tagsBySeriesID {
		if item, ok := itemByID[seriesID]; ok {
			item.Tags = tags
		}
	}
	eyeCatchVariantsByImageID, err := s.seriesEyeCatchVariantsByImageIDs(ctx, seriesImageIDs)
	if err != nil {
		return nil, err
	}
	for imageID, variants := range eyeCatchVariantsByImageID {
		if item, ok := itemByImageID[imageID]; ok {
			item.EyeCatchImageVariants = variants
		}
	}
	defaultReadingPeriodHours := int32(0)
	if tenant.DefaultReadingPeriodHours.Valid {
		defaultReadingPeriodHours = tenant.DefaultReadingPeriodHours.Int32
	}

	res := &publiraadminv1.ListSeriesResponse{
		Series:                    items,
		DefaultReadingPeriodHours: defaultReadingPeriodHours,
	}
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

	return connect.NewResponse(res), nil
}

func (s *adminServer) GetSeries(
	ctx context.Context,
	req *connect.Request[publiraadminv1.GetSeriesRequest],
) (*connect.Response[publiraadminv1.GetSeriesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	row, err := s.queriesFor(ctx).GetSeriesByPublicIDForTenant(ctx, dbmodels.GetSeriesByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.PublicId})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("series not found"))
		}
		return nil, s.internalDBError(ctx, "failed to get series", err, "tenant_id", tenant.ID.String(), "series_public_id", req.Msg.PublicId)
	}
	creatorsBySeriesID, err := s.seriesCreatorsBySeriesIDs(ctx, []uuid.UUID{row.ID})
	if err != nil {
		return nil, err
	}
	genresBySeriesID, err := s.seriesGenresBySeriesIDs(ctx, []uuid.UUID{row.ID})
	if err != nil {
		return nil, err
	}
	tagsBySeriesID, err := s.seriesTagsBySeriesIDs(ctx, []uuid.UUID{row.ID})
	if err != nil {
		return nil, err
	}
	series, err := protomapper.SeriesFromGetSeriesByPublicIDForTenantRow(row)
	if err != nil {
		return nil, s.internalError(ctx, "series listing holds a value this build does not know", err, "tenant_id", tenant.ID.String(), "series_public_id", row.PublicID)
	}
	if row.EyeCatchImageID.Valid {
		variantsByImageID, variantErr := s.seriesEyeCatchVariantsByImageIDs(ctx, []uuid.UUID{row.EyeCatchImageID.UUID})
		if variantErr != nil {
			return nil, variantErr
		}
		series.EyeCatchImageVariants = variantsByImageID[row.EyeCatchImageID.UUID]
	}
	series.Creators = creatorsBySeriesID[row.ID]
	series.Genres = genresBySeriesID[row.ID]
	series.Tags = tagsBySeriesID[row.ID]
	commentMode, err := protomapper.CommentModeOverrideFromStored(row.CommentMode)
	if err != nil {
		return nil, s.internalError(ctx, "series listing holds a value this build does not know", err, "tenant_id", tenant.ID.String(), "series_public_id", row.PublicID)
	}
	return connect.NewResponse(&publiraadminv1.GetSeriesResponse{Series: series, CommentMode: commentMode}), nil
}
