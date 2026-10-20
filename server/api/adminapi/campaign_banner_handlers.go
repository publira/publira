package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/api/protomapper"
	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/campaignbanners"
	"github.com/publira/publira/server/internal/clientip"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/imageproc"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/publicid"
	"github.com/publira/publira/server/internal/revalidate"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/storage"
)

const (
	// maxCampaignBanners is how many banners one tenant may hold, expired ones
	// included. The console orders all of them on one screen, which is why no
	// list of them is paged, and a reorder request carries the whole list.
	maxCampaignBanners = 50

	// maxCampaignBannerLinkRunes is what a browser keeps in its address bar,
	// and what campaign_banners_link_url_check holds the column to.
	maxCampaignBannerLinkRunes = 2048

	// maxCampaignBannerAltTextRunes is what campaign_banners_alt_text_check
	// holds the column to. A screen reader reads the whole of it every time
	// the link is reached, so it is the banner's copy, not a description of
	// the picture.
	maxCampaignBannerAltTextRunes = 255

	// campaignBannerImagePath is where a banner's objects are filed and the
	// image route it is served from.
	campaignBannerImagePath = "campaign-banners"

	// campaignBannerVariantType is the one ratio the site and the app draw a
	// banner in, so a banner's whole image is stored as that cut alone and
	// held to its minimum rather than to the larger one of every other ratio.
	campaignBannerVariantType = "landscape"
)

var errCampaignBannerLimit = errors.New("the tenant holds as many campaign banners as it may")

// normalizeCampaignBannerLink reads the address a banner opens. A path stays a
// path, so a banner keeps working on every host name the tenant's site is
// served from; anything else has to be an absolute http(s) URL. A path that
// starts with "//" or "/\" is refused, because a browser reads either as
// another site.
func normalizeCampaignBannerLink(raw string) (string, error) {
	link := strings.TrimSpace(raw)
	if link == "" {
		return "", rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("link_url is required"), "link_url")
	}
	if utf8.RuneCountInString(link) > maxCampaignBannerLinkRunes {
		return "", rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, fmt.Errorf("link_url must be at most %d characters", maxCampaignBannerLinkRunes), "link_url")
	}
	invalid := rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("link_url must be a path starting with / or an http(s) URL"), "link_url")
	parsed, err := url.Parse(link)
	if err != nil {
		return "", invalid
	}
	if strings.HasPrefix(link, "/") {
		if strings.HasPrefix(link, "//") || strings.HasPrefix(link, `/\`) {
			return "", invalid
		}
		return link, nil
	}
	if (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" {
		return "", invalid
	}
	return link, nil
}

// normalizeCampaignBannerAltText reads the words drawn into a banner's image.
// They are optional: a banner nobody has described is named by each client's
// generic text, which is what every banner stored before the field was.
func normalizeCampaignBannerAltText(raw string) (string, error) {
	altText := strings.TrimSpace(raw)
	if utf8.RuneCountInString(altText) > maxCampaignBannerAltTextRunes {
		return "", rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, fmt.Errorf("alt_text must be at most %d characters", maxCampaignBannerAltTextRunes), "alt_text")
	}
	return altText, nil
}

// campaignBannerWindow is a validated display window, in UTC.
type campaignBannerWindow struct {
	startsAt time.Time
	endsAt   time.Time
}

func (w campaignBannerWindow) equal(startsAt, endsAt time.Time) bool {
	return w.startsAt.Equal(startsAt) && w.endsAt.Equal(endsAt)
}

// parseCampaignBannerWindow reads the two instants a banner shows between.
// Both are truncated to the second, because they are answered with
// time.RFC3339: what is stored is then exactly what the console reads back,
// and an end it reuses as the next banner's start meets it rather than
// overlapping it by a fraction of a second.
func parseCampaignBannerWindow(startsAt, endsAt string) (campaignBannerWindow, error) {
	start, err := time.Parse(time.RFC3339, strings.TrimSpace(startsAt))
	if err != nil {
		return campaignBannerWindow{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("starts_at must be RFC3339"), "starts_at")
	}
	end, err := time.Parse(time.RFC3339, strings.TrimSpace(endsAt))
	if err != nil {
		return campaignBannerWindow{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("ends_at must be RFC3339"), "ends_at")
	}
	window := campaignBannerWindow{
		startsAt: start.UTC().Truncate(time.Second),
		endsAt:   end.UTC().Truncate(time.Second),
	}
	if !window.endsAt.After(window.startsAt) {
		return campaignBannerWindow{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("ends_at must be after starts_at"), "ends_at")
	}
	return window, nil
}

// requireFutureCampaignBannerEnd refuses a window that is already over. It
// would store a banner nobody can see, which is more likely a mistyped date
// than a campaign. A window that starts in the past is how a banner goes up
// at once, so the start is not held to anything.
func requireFutureCampaignBannerEnd(window campaignBannerWindow, now time.Time) error {
	if !window.endsAt.After(now) {
		return rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("ends_at must be in the future"), "ends_at")
	}
	return nil
}

// campaignBannerImageVariants cuts an uploaded banner image into its landscape
// cut before the caller opens its transaction, so a refused image costs no
// database work and the cut does not run while the row is held. Nil means no
// upload.
func (s *adminServer) campaignBannerImageVariants(data []byte, contentType string) ([]imageproc.Variant, error) {
	image, err := normalizeEyeCatchImage(data, contentType, "image_data", "image_content_type")
	if err != nil || image == nil {
		return nil, err
	}
	if s.storage == nil {
		return nil, connect.NewError(connect.CodeInternal, "storage provider is not configured")
	}
	variants, err := imageproc.BuildEyeCatchAspectVariants(image.Data, image.ContentType, campaignBannerVariantType, nil)
	if err != nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "image_data")
	}
	return variants, nil
}

// createCampaignBannerImage stores a whole banner image, one object and one
// row per width of its cut, and answers the image row the banner is then
// pointed at.
func (s *adminServer) createCampaignBannerImage(ctx context.Context, tenant dbmodels.Tenant, bannerID uuid.UUID, bannerPublicID string, variants []imageproc.Variant) (uuid.UUID, error) {
	imageID, err := uuid.NewV7()
	if err != nil {
		return uuid.Nil, connect.NewError(connect.CodeInternal, err.Error()).WithCause(err)
	}
	created, err := s.queriesFor(ctx).CreateCampaignBannerImage(ctx, dbmodels.CreateCampaignBannerImageParams{
		ID:               imageID,
		TenantID:         tenant.ID,
		CampaignBannerID: bannerID,
	})
	if err != nil {
		return uuid.Nil, s.internalDBError(ctx, "failed to create campaign banner image", err, "tenant_id", tenant.ID.String(), "campaign_banner_id", bannerID.String())
	}

	store, err := storage.Pin(ctx, s.storage)
	if err != nil {
		return uuid.Nil, storageUploadError(err)
	}
	for _, variant := range variants {
		uploaded, uploadErr := store.Upload(ctx, storage.UploadRequest{
			ObjectKey: fmt.Sprintf(
				"tenants/%s/%s/%s/%s-%s%s",
				tenant.PublicID,
				campaignBannerImagePath,
				bannerPublicID,
				created.ID.String(),
				variant.Label,
				variant.Extension,
			),
			ContentType: variant.ContentType,
			Data:        variant.Data,
		})
		if uploadErr != nil {
			return uuid.Nil, storageUploadError(uploadErr)
		}
		if err := s.createCampaignBannerImageVariant(ctx, tenant.ID, created.ID, variant, uploaded); err != nil {
			return uuid.Nil, err
		}
	}
	return created.ID, nil
}

func (s *adminServer) createCampaignBannerImageVariant(ctx context.Context, tenantID, imageID uuid.UUID, variant imageproc.Variant, uploaded storage.UploadResult) error {
	variantID, err := uuid.NewV7()
	if err != nil {
		return connect.NewError(connect.CodeInternal, err.Error()).WithCause(err)
	}
	if _, err := s.queriesFor(ctx).CreateCampaignBannerImageVariant(ctx, dbmodels.CreateCampaignBannerImageVariantParams{
		ID:                    variantID,
		TenantID:              tenantID,
		CampaignBannerImageID: imageID,
		VariantType:           variant.VariantType,
		Label:                 variant.Label,
		StorageProvider:       uploaded.Provider,
		ObjectKey:             uploaded.ObjectKey,
		ContentType:           variant.ContentType,
		FileSizeBytes:         uploaded.SizeBytes,
		Width:                 int32(variant.Width),
		Height:                int32(variant.Height),
	}); err != nil {
		return s.internalDBError(ctx, "failed to create campaign banner image variant", err, "tenant_id", tenantID.String(), "campaign_banner_image_id", imageID.String())
	}
	return nil
}

// campaignBannerRow is a banner as every admin banner RPC answers with it,
// whichever query read it.
type campaignBannerRow struct {
	id             uuid.UUID
	publicID       string
	linkURL        string
	altText        string
	startsAt       time.Time
	endsAt         time.Time
	published      bool
	imageID        uuid.NullUUID
	imageUpdatedAt sql.NullTime
	createdAt      time.Time
	updatedAt      time.Time
}

func campaignBannerRowFromGet(row dbmodels.GetCampaignBannerByIDForTenantRow) campaignBannerRow {
	return campaignBannerRow{
		id:             row.ID,
		publicID:       row.PublicID,
		linkURL:        row.LinkUrl,
		altText:        row.AltText,
		startsAt:       row.StartsAt,
		endsAt:         row.EndsAt,
		published:      row.IsPublished,
		imageID:        row.ImageID,
		imageUpdatedAt: row.ImageUpdatedAt,
		createdAt:      row.CreatedAt,
		updatedAt:      row.UpdatedAt,
	}
}

func campaignBannerRowFromList(row dbmodels.ListCampaignBannersForTenantRow) campaignBannerRow {
	return campaignBannerRow{
		id:             row.ID,
		publicID:       row.PublicID,
		linkURL:        row.LinkUrl,
		altText:        row.AltText,
		startsAt:       row.StartsAt,
		endsAt:         row.EndsAt,
		published:      row.IsPublished,
		imageID:        row.ImageID,
		imageUpdatedAt: row.ImageUpdatedAt,
		createdAt:      row.CreatedAt,
		updatedAt:      row.UpdatedAt,
	}
}

// campaignBannerMessages builds the answer for a list of banners, reading the
// variants of every image among them in one query.
func (s *adminServer) campaignBannerMessages(ctx context.Context, rows []campaignBannerRow) ([]*publiraadminv1.AdminCampaignBanner, error) {
	banners := make([]*publiraadminv1.AdminCampaignBanner, 0, len(rows))
	imageIDs := make([]uuid.UUID, 0, len(rows))
	bannerByImageID := make(map[uuid.UUID]*publiraadminv1.AdminCampaignBanner, len(rows))
	for _, row := range rows {
		banner := &publiraadminv1.AdminCampaignBanner{
			Id:        row.id.String(),
			PublicId:  row.publicID,
			LinkUrl:   row.linkURL,
			AltText:   row.altText,
			StartsAt:  row.startsAt.UTC().Format(time.RFC3339),
			EndsAt:    row.endsAt.UTC().Format(time.RFC3339),
			Published: row.published,
			CreatedAt: row.createdAt.UTC().Format(time.RFC3339),
			UpdatedAt: row.updatedAt.UTC().Format(time.RFC3339),
		}
		if row.imageUpdatedAt.Valid {
			banner.ImageUpdatedAt = row.imageUpdatedAt.Time.UTC().Format(time.RFC3339)
		}
		banners = append(banners, banner)
		if row.imageID.Valid {
			imageIDs = append(imageIDs, row.imageID.UUID)
			bannerByImageID[row.imageID.UUID] = banner
		}
	}
	variantsByImageID, err := s.campaignBannerImageVariantsByImageIDs(ctx, imageIDs)
	if err != nil {
		return nil, err
	}
	for imageID, variants := range variantsByImageID {
		if banner, ok := bannerByImageID[imageID]; ok {
			banner.ImageVariants = variants
		}
	}
	return banners, nil
}

func (s *adminServer) campaignBannerImageVariantsByImageIDs(
	ctx context.Context,
	imageIDs []uuid.UUID,
) (map[uuid.UUID][]*publirattypesv1.SeriesEyeCatchVariant, error) {
	if len(imageIDs) == 0 {
		return map[uuid.UUID][]*publirattypesv1.SeriesEyeCatchVariant{}, nil
	}

	rows, err := s.queriesFor(ctx).ListCampaignBannerImageVariantsByImageIDs(ctx, imageIDs)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list campaign banner image variants", err)
	}

	mapped := make(map[uuid.UUID][]*publirattypesv1.SeriesEyeCatchVariant, len(imageIDs))
	for _, row := range rows {
		mapped[row.CampaignBannerImageID] = append(mapped[row.CampaignBannerImageID], &publirattypesv1.SeriesEyeCatchVariant{
			Label:         row.Label,
			VariantType:   row.VariantType,
			Url:           protomapper.EyeCatchVariantURL(campaignBannerImagePath, row.CampaignBannerImageID, row.VariantType, row.Width, row.ID),
			ContentType:   row.ContentType,
			Width:         row.Width,
			Height:        row.Height,
			FileSizeBytes: row.FileSizeBytes,
		})
	}
	return mapped, nil
}

// campaignBannerByID reads the banner a request names.
func (s *adminServer) campaignBannerByID(ctx context.Context, tenantID, id uuid.UUID) (dbmodels.GetCampaignBannerByIDForTenantRow, error) {
	row, err := s.queriesFor(ctx).GetCampaignBannerByIDForTenant(ctx, dbmodels.GetCampaignBannerByIDForTenantParams{TenantID: tenantID, ID: id})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dbmodels.GetCampaignBannerByIDForTenantRow{}, connect.NewError(connect.CodeNotFound, "campaign banner not found")
		}
		return dbmodels.GetCampaignBannerByIDForTenantRow{}, s.internalDBError(ctx, "failed to get campaign banner", err, "tenant_id", tenantID.String(), "campaign_banner_id", id.String())
	}
	return row, nil
}

// lockCampaignBannerByID takes the row lock every write on one banner
// serializes behind; the caller re-reads the banner after it.
func (s *adminServer) lockCampaignBannerByID(ctx context.Context, tenantID, id uuid.UUID) error {
	if _, err := s.queriesFor(ctx).LockCampaignBannerByIDForTenant(ctx, dbmodels.LockCampaignBannerByIDForTenantParams{TenantID: tenantID, ID: id}); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return connect.NewError(connect.CodeNotFound, "campaign banner not found")
		}
		return s.internalDBError(ctx, "failed to lock campaign banner", err, "tenant_id", tenantID.String(), "campaign_banner_id", id.String())
	}
	return nil
}

// campaignBannerMessageByID re-reads a banner, so the answer to a write
// carries the image delivery now serves.
func (s *adminServer) campaignBannerMessageByID(ctx context.Context, tenantID, id uuid.UUID) (*publiraadminv1.AdminCampaignBanner, error) {
	row, err := s.campaignBannerByID(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	banners, err := s.campaignBannerMessages(ctx, []campaignBannerRow{campaignBannerRowFromGet(row)})
	if err != nil {
		return nil, err
	}
	return banners[0], nil
}

// recordCampaignBannerRevalidation records the drop of the band a site
// cached, on the write's own transaction. A banner that was not published
// before the write and is not after it is in no cached answer, so its write
// owes nothing.
func (s *adminServer) recordCampaignBannerRevalidation(ctx context.Context, tenantID uuid.UUID, wasPublished, isPublished bool) (revalidate.Owed, error) {
	if !wasPublished && !isPublished {
		return revalidate.Owed{}, nil
	}
	return s.recordRevalidation(ctx, tenantID, campaignbanners.RevalidateTags(tenantID))
}

// recordCampaignBannerChange files the audit entry for one banner write. A
// banner is what every reader sees first on the storefront, so every write is
// recorded, not only the destructive one.
func (s *adminServer) recordCampaignBannerChange(ctx context.Context, tenantID uuid.UUID, action, targetID string) {
	sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx)
	if !ok {
		return
	}
	s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    tenantID,
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		Action:      action,
		TargetType:  "campaign_banner",
		TargetID:    targetID,
		Outcome:     auditlog.OutcomeSuccess,
		ClientIP:    clientip.FromContext(ctx),
	})
}

func (s *adminServer) ListCampaignBanners(
	ctx context.Context,
	req *publiraadminv1.ListCampaignBannersRequest,
) (*publiraadminv1.ListCampaignBannersResponse, error) {
	if _, err := s.requireTenantAuditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	banners, err := s.campaignBannersOfTenant(ctx, tenant.ID)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.ListCampaignBannersResponse{Banners: banners}, nil
}

func (s *adminServer) campaignBannersOfTenant(ctx context.Context, tenantID uuid.UUID) ([]*publiraadminv1.AdminCampaignBanner, error) {
	rows, err := s.queriesFor(ctx).ListCampaignBannersForTenant(ctx, tenantID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list campaign banners", err, "tenant_id", tenantID.String())
	}
	mapped := make([]campaignBannerRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, campaignBannerRowFromList(row))
	}
	return s.campaignBannerMessages(ctx, mapped)
}

func (s *adminServer) GetCampaignBanner(
	ctx context.Context,
	req *publiraadminv1.GetCampaignBannerRequest,
) (*publiraadminv1.GetCampaignBannerResponse, error) {
	if _, err := s.requireTenantAuditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	id, err := parseRecordID(req.CampaignBannerId, "campaign_banner_id")
	if err != nil {
		return nil, err
	}
	banner, err := s.campaignBannerMessageByID(ctx, tenant.ID, id)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.GetCampaignBannerResponse{Banner: banner}, nil
}

func (s *adminServer) CreateCampaignBanner(
	ctx context.Context,
	req *publiraadminv1.CreateCampaignBannerRequest,
) (*publiraadminv1.CreateCampaignBannerResponse, error) {
	if _, err := s.requireTenantEditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	link, err := normalizeCampaignBannerLink(req.LinkUrl)
	if err != nil {
		return nil, err
	}
	altText, err := normalizeCampaignBannerAltText(req.AltText)
	if err != nil {
		return nil, err
	}
	window, err := parseCampaignBannerWindow(req.StartsAt, req.EndsAt)
	if err != nil {
		return nil, err
	}
	if err := requireFutureCampaignBannerEnd(window, time.Now()); err != nil {
		return nil, err
	}
	if len(req.ImageData) == 0 {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("image_data is required"), "image_data")
	}
	variants, err := s.campaignBannerImageVariants(req.ImageData, req.ImageContentType)
	if err != nil {
		return nil, err
	}
	bannerID, err := uuid.NewV7()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err.Error()).WithCause(err)
	}

	// The banner and its image commit together, so a failed upload leaves no
	// banner without an image behind to count against the cap.
	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin create campaign banner transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txCtx := rpcmiddleware.WithTenantQueries(ctx, dbmodels.New(tx))
	queries := s.queriesFor(txCtx)

	if _, err := queries.LockTenantForCampaignBanners(txCtx, tenant.ID); err != nil {
		return nil, s.internalDBError(ctx, "failed to lock the tenant for a campaign banner create", err, "tenant_id", tenant.ID.String())
	}
	count, err := queries.CountCampaignBannersForTenant(txCtx, tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to count campaign banners", err, "tenant_id", tenant.ID.String())
	}
	if count >= maxCampaignBanners {
		return nil, rpcerrors.NewErrorInfoError(connect.CodeFailedPrecondition, errCampaignBannerLimit, rpcerrors.ReasonCampaignBannerLimit)
	}
	maxDisplayOrder, err := queries.GetMaxCampaignBannerDisplayOrderForTenant(txCtx, tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to resolve the next campaign banner display order", err, "tenant_id", tenant.ID.String())
	}
	created, err := publicid.InsertTx(txCtx, tx, func(publicID string) (dbmodels.CreateCampaignBannerRow, error) {
		return queries.CreateCampaignBanner(txCtx, dbmodels.CreateCampaignBannerParams{
			ID:           bannerID,
			TenantID:     tenant.ID,
			PublicID:     publicID,
			LinkUrl:      link,
			AltText:      altText,
			StartsAt:     window.startsAt,
			EndsAt:       window.endsAt,
			DisplayOrder: maxDisplayOrder + 1,
			IsPublished:  req.Published,
		})
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to create campaign banner", err, "tenant_id", tenant.ID.String())
	}
	imageID, err := s.createCampaignBannerImage(txCtx, tenant, created.ID, created.PublicID, variants)
	if err != nil {
		return nil, err
	}
	if err := queries.SetCampaignBannerImage(txCtx, dbmodels.SetCampaignBannerImageParams{
		ID:      created.ID,
		ImageID: uuid.NullUUID{UUID: imageID, Valid: true},
	}); err != nil {
		return nil, s.internalDBError(ctx, "failed to point the campaign banner at its image", err, "tenant_id", tenant.ID.String(), "campaign_banner_id", created.ID.String())
	}
	owed, err := s.recordCampaignBannerRevalidation(txCtx, tenant.ID, false, req.Published)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to record the cache invalidation for the created campaign banner", err, "tenant_id", tenant.ID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit create campaign banner", err, "tenant_id", tenant.ID.String())
	}
	s.reval.Send(ctx, owed)

	s.recordCampaignBannerChange(ctx, tenant.ID, "campaign_banner_created", created.PublicID)

	banner, err := s.campaignBannerMessageByID(ctx, tenant.ID, created.ID)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.CreateCampaignBannerResponse{Banner: banner}, nil
}

func (s *adminServer) UpdateCampaignBanner(
	ctx context.Context,
	req *publiraadminv1.UpdateCampaignBannerRequest,
) (*publiraadminv1.UpdateCampaignBannerResponse, error) {
	if _, err := s.requireTenantEditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	id, err := parseRecordID(req.CampaignBannerId, "campaign_banner_id")
	if err != nil {
		return nil, err
	}
	link, err := normalizeCampaignBannerLink(req.LinkUrl)
	if err != nil {
		return nil, err
	}
	altText, err := normalizeCampaignBannerAltText(req.AltText)
	if err != nil {
		return nil, err
	}
	window, err := parseCampaignBannerWindow(req.StartsAt, req.EndsAt)
	if err != nil {
		return nil, err
	}
	variants, err := s.campaignBannerImageVariants(req.ImageData, req.ImageContentType)
	if err != nil {
		return nil, err
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin update campaign banner transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txCtx := rpcmiddleware.WithTenantQueries(ctx, dbmodels.New(tx))

	// Every update writes image_id back, so it is read behind the lock: an
	// edit racing an image replacement would otherwise restore the image the
	// other write had just changed.
	if err := s.lockCampaignBannerByID(txCtx, tenant.ID, id); err != nil {
		return nil, err
	}
	current, err := s.campaignBannerByID(txCtx, tenant.ID, id)
	if err != nil {
		return nil, err
	}
	// A window the banner already has may stay over, so an expired banner can
	// be unpublished or relinked without being rescheduled first.
	if !window.equal(current.StartsAt, current.EndsAt) {
		if err := requireFutureCampaignBannerEnd(window, time.Now()); err != nil {
			return nil, err
		}
	}

	imageID := current.ImageID
	if len(variants) > 0 {
		created, err := s.createCampaignBannerImage(txCtx, tenant, current.ID, current.PublicID, variants)
		if err != nil {
			return nil, err
		}
		imageID = uuid.NullUUID{UUID: created, Valid: true}
	}
	if err := s.queriesFor(txCtx).UpdateCampaignBanner(txCtx, dbmodels.UpdateCampaignBannerParams{
		ID:          current.ID,
		LinkUrl:     link,
		AltText:     altText,
		StartsAt:    window.startsAt,
		EndsAt:      window.endsAt,
		IsPublished: req.Published,
		ImageID:     imageID,
	}); err != nil {
		return nil, s.internalDBError(ctx, "failed to update campaign banner", err, "tenant_id", tenant.ID.String(), "campaign_banner_id", current.ID.String())
	}
	owed, err := s.recordCampaignBannerRevalidation(txCtx, tenant.ID, current.IsPublished, req.Published)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to record the cache invalidation for the updated campaign banner", err, "tenant_id", tenant.ID.String(), "campaign_banner_id", current.ID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit update campaign banner", err, "tenant_id", tenant.ID.String(), "campaign_banner_id", current.ID.String())
	}
	s.reval.Send(ctx, owed)

	s.recordCampaignBannerChange(ctx, tenant.ID, "campaign_banner_updated", current.PublicID)

	banner, err := s.campaignBannerMessageByID(ctx, tenant.ID, current.ID)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.UpdateCampaignBannerResponse{Banner: banner}, nil
}

func (s *adminServer) ReorderCampaignBanners(
	ctx context.Context,
	req *publiraadminv1.ReorderCampaignBannersRequest,
) (*publiraadminv1.ReorderCampaignBannersResponse, error) {
	if _, err := s.requireTenantEditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	order, expected, err := reorderIDs(
		reorderList{req.CampaignBannerIds, "campaign_banner_ids"},
		reorderList{req.ExpectedCampaignBannerIds, "expected_campaign_banner_ids"},
		"campaign banner",
	)
	if err != nil {
		return nil, err
	}

	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		queries := s.queriesFor(txCtx)
		// Locking every banner of the tenant is what makes the comparison below
		// mean something: no concurrent write can add, remove, or move one
		// between the check and the write.
		locked, err := queries.LockCampaignBannersForTenant(txCtx, tenant.ID)
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to lock campaign banners for reorder", err, "tenant_id", tenant.ID.String())
		}
		currentOrder := make([]string, 0, len(locked))
		for _, id := range locked {
			currentOrder = append(currentOrder, id.String())
		}
		if !slices.Equal(currentOrder, expected) {
			return nil, connect.NewError(connect.CodeFailedPrecondition, "campaign banner order has changed")
		}
		for index, key := range order {
			id := uuid.MustParse(key)
			if err := queries.UpdateCampaignBannerDisplayOrder(txCtx, dbmodels.UpdateCampaignBannerDisplayOrderParams{
				ID:           id,
				DisplayOrder: int32(index + 1),
			}); err != nil {
				return nil, s.internalDBError(ctx, "failed to update campaign banner display order", err, "tenant_id", tenant.ID.String(), "campaign_banner_id", key)
			}
		}
		// The order is what the band shows its banners in, so the drop is owed
		// whichever of them are showing now.
		return campaignbanners.RevalidateTags(tenant.ID), nil
	}); err != nil {
		return nil, err
	}

	s.recordCampaignBannerChange(ctx, tenant.ID, "campaign_banners_reordered", tenant.PublicID)

	banners, err := s.campaignBannersOfTenant(ctx, tenant.ID)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.ReorderCampaignBannersResponse{Banners: banners}, nil
}

func (s *adminServer) DeleteCampaignBanner(
	ctx context.Context,
	req *publiraadminv1.DeleteCampaignBannerRequest,
) (*publiraadminv1.DeleteCampaignBannerResponse, error) {
	if _, err := s.requireTenantEditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	id, err := parseRecordID(req.CampaignBannerId, "campaign_banner_id")
	if err != nil {
		return nil, err
	}

	var publicID string
	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		if err := s.lockCampaignBannerByID(txCtx, tenant.ID, id); err != nil {
			return nil, err
		}
		current, err := s.campaignBannerByID(txCtx, tenant.ID, id)
		if err != nil {
			return nil, err
		}
		publicID = current.PublicID
		if _, err := s.queriesFor(txCtx).DeleteCampaignBanner(txCtx, dbmodels.DeleteCampaignBannerParams{
			TenantID: tenant.ID,
			ID:       current.ID,
		}); err != nil {
			return nil, s.internalDBError(ctx, "failed to delete campaign banner", err, "tenant_id", tenant.ID.String(), "campaign_banner_id", current.ID.String())
		}
		if !current.IsPublished {
			return nil, nil
		}
		return campaignbanners.RevalidateTags(tenant.ID), nil
	}); err != nil {
		return nil, err
	}

	s.recordCampaignBannerChange(ctx, tenant.ID, "campaign_banner_deleted", publicID)

	return &publiraadminv1.DeleteCampaignBannerResponse{}, nil
}

func (s *adminServer) UploadCampaignBannerAspectImage(
	ctx context.Context,
	req *publiraadminv1.UploadCampaignBannerAspectImageRequest,
) (*publiraadminv1.UploadCampaignBannerAspectImageResponse, error) {
	if _, err := s.requireTenantEditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	aspect, err := resolveEyeCatchAspect(req.VariantType)
	if err != nil {
		return nil, err
	}
	image, err := normalizeEyeCatchImage(req.ImageData, req.ImageContentType, "image_data", "image_content_type")
	if err != nil {
		return nil, err
	}
	if image == nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("image_data is required"), "image_data")
	}
	if s.storage == nil {
		return nil, connect.NewError(connect.CodeInternal, "storage provider is not configured")
	}
	id, err := parseRecordID(req.CampaignBannerId, "campaign_banner_id")
	if err != nil {
		return nil, err
	}
	if _, err := s.campaignBannerByID(ctx, tenant.ID, id); err != nil {
		return nil, err
	}

	variants, err := imageproc.BuildEyeCatchAspectVariants(image.Data, image.ContentType, aspect.VariantType, imageCropRect(req.Crop))
	if err != nil {
		return nil, eyeCatchAspectBuildError(err)
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin campaign banner aspect upload transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txCtx := rpcmiddleware.WithTenantQueries(ctx, dbmodels.New(tx))

	// Serialized and re-read behind the lock, like the series upload: two
	// uploads racing on one ratio would otherwise both clear it and then both
	// insert the same (image, ratio, width).
	if err := s.lockCampaignBannerByID(txCtx, tenant.ID, id); err != nil {
		return nil, err
	}
	locked, err := s.campaignBannerByID(txCtx, tenant.ID, id)
	if err != nil {
		return nil, err
	}
	if !locked.ImageID.Valid {
		return nil, connect.NewError(connect.CodeFailedPrecondition, "campaign banner has no image yet")
	}

	imageID := locked.ImageID.UUID
	if _, err := s.queriesFor(txCtx).DeleteCampaignBannerImageVariantsByType(txCtx, dbmodels.DeleteCampaignBannerImageVariantsByTypeParams{
		CampaignBannerImageID: imageID,
		VariantType:           aspect.VariantType,
	}); err != nil {
		return nil, s.internalDBError(ctx, "failed to clear campaign banner image variants for aspect", err, "tenant_id", tenant.ID.String(), "campaign_banner_image_id", imageID.String())
	}

	uploadID, err := uuid.NewV7()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err.Error()).WithCause(err)
	}
	store, err := storage.Pin(txCtx, s.storage)
	if err != nil {
		return nil, storageUploadError(err)
	}
	for _, variant := range variants {
		uploaded, uploadErr := store.Upload(txCtx, storage.UploadRequest{
			ObjectKey:   aspectImageObjectKey(tenant.PublicID, campaignBannerImagePath, locked.PublicID, imageID, uploadID, variant),
			ContentType: variant.ContentType,
			Data:        variant.Data,
		})
		if uploadErr != nil {
			return nil, storageUploadError(uploadErr)
		}
		if err := s.createCampaignBannerImageVariant(txCtx, tenant.ID, imageID, variant, uploaded); err != nil {
			return nil, err
		}
	}
	if err := s.queriesFor(txCtx).TouchCampaignBannerImage(txCtx, imageID); err != nil {
		return nil, s.internalDBError(ctx, "failed to touch campaign banner image", err, "tenant_id", tenant.ID.String(), "campaign_banner_image_id", imageID.String())
	}
	owed, err := s.recordCampaignBannerRevalidation(txCtx, tenant.ID, locked.IsPublished, locked.IsPublished)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to record the cache invalidation for the campaign banner aspect upload", err, "tenant_id", tenant.ID.String(), "campaign_banner_id", locked.ID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit campaign banner aspect upload", err, "tenant_id", tenant.ID.String(), "campaign_banner_id", locked.ID.String())
	}
	s.reval.Send(ctx, owed)

	s.recordEyeCatchAspectAudit(ctx, tenant.ID, "campaign_banner", locked.PublicID, "campaign_banner_aspect_image_uploaded", aspect.VariantType)

	banner, err := s.campaignBannerMessageByID(ctx, tenant.ID, locked.ID)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.UploadCampaignBannerAspectImageResponse{Banner: banner}, nil
}
