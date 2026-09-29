package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/locale"
	"github.com/publira/publira/server/internal/pageslug"
	"github.com/publira/publira/server/internal/pagination"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

var slugSegmentPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9\-]*$`)

const (
	slugMaxLen           = 255
	defaultPageListLimit = int32(20)
	maxPageListLimit     = int32(100)
)

// pageRow is a page with the translation an admin request works on.
type pageRow struct {
	Page            dbmodels.Page
	PageTranslation dbmodels.PageTranslation
}

func (s *adminServer) pagePage(
	ctx context.Context,
	tenant dbmodels.Tenant,
	keys pagination.TimeUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]pageRow, error) {
	queries := s.queriesFor(ctx)
	if direction == pagination.Backward {
		rows, err := queries.ListPagesForTenantDesc(ctx, dbmodels.ListPagesForTenantDescParams{
			Locale:          tenant.DefaultLocale,
			TenantID:        tenant.ID,
			CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
			CursorInclusive: keys.Inclusive,
			CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
			Limit:           limit,
		})
		pages := make([]pageRow, 0, len(rows))
		for _, row := range rows {
			pages = append(pages, pageRow(row))
		}
		return pages, err
	}

	rows, err := queries.ListPagesForTenantAsc(ctx, dbmodels.ListPagesForTenantAscParams{
		Locale:          tenant.DefaultLocale,
		TenantID:        tenant.ID,
		CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
		CursorInclusive: keys.Inclusive,
		CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
		Limit:           limit,
	})
	pages := make([]pageRow, 0, len(rows))
	for _, row := range rows {
		pages = append(pages, pageRow(row))
	}
	return pages, err
}

// getPage answers the page with the translation pageRow names, or not_found
// when the tenant has no such page.
func (s *adminServer) getPage(ctx context.Context, tenant dbmodels.Tenant, pageID uuid.UUID, operation string) (pageRow, error) {
	row, err := s.queriesFor(ctx).GetPageByIDForTenant(ctx, dbmodels.GetPageByIDForTenantParams{
		ID:       pageID,
		TenantID: tenant.ID,
		Locale:   tenant.DefaultLocale,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return pageRow{}, connect.NewError(connect.CodeNotFound, errors.New("page not found"))
		}
		return pageRow{}, s.internalDBError(ctx, "failed to get page for "+operation, err, "tenant_id", tenant.ID.String(), "page_id", pageID.String())
	}
	return pageRow(row), nil
}

// pageTranslation answers the page with the translation a request carrying
// rawLocale works on, as AdminPagesService describes: getPage's for an empty
// locale, else exactly that locale's, or not_found.
func (s *adminServer) pageTranslation(ctx context.Context, tenant dbmodels.Tenant, pageID uuid.UUID, rawLocale, operation string) (pageRow, error) {
	if strings.TrimSpace(rawLocale) == "" {
		return s.getPage(ctx, tenant, pageID, operation)
	}
	code, err := parsePageLocale(rawLocale)
	if err != nil {
		return pageRow{}, err
	}
	row, err := s.queriesFor(ctx).GetPageWithTranslationForTenant(ctx, dbmodels.GetPageWithTranslationForTenantParams{
		ID:       pageID,
		TenantID: tenant.ID,
		Locale:   code,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return pageRow{}, connect.NewError(connect.CodeNotFound, errors.New("page translation not found"))
		}
		return pageRow{}, s.internalDBError(ctx, "failed to get page translation for "+operation, err, "tenant_id", tenant.ID.String(), "page_id", pageID.String(), "locale", code)
	}
	return pageRow(row), nil
}

func parsePageLocale(raw string) (string, error) {
	code, err := locale.Normalize(raw)
	if err != nil {
		return "", rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("locale must be a supported locale"), "locale")
	}
	return code, nil
}

func pageFromModel(p dbmodels.Page, t dbmodels.PageTranslation) *publirattypesv1.Page {
	updatedAt := p.UpdatedAt
	if t.UpdatedAt.After(updatedAt) {
		updatedAt = t.UpdatedAt
	}
	proto := &publirattypesv1.Page{
		Id:              p.ID.String(),
		Slug:            p.Slug,
		Title:           t.Title,
		CreatedAt:       p.CreatedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt:       updatedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
		DisplayInFooter: p.DisplayInFooter,
		Locale:          t.Locale,
	}
	if t.PublishedVersionID.Valid {
		proto.PublishedVersionId = t.PublishedVersionID.UUID.String()
	}
	return proto
}

func pageTranslationFromModel(t dbmodels.PageTranslation) *publirattypesv1.PageTranslation {
	proto := &publirattypesv1.PageTranslation{
		Id:        t.ID.String(),
		PageId:    t.PageID.String(),
		Locale:    t.Locale,
		Title:     t.Title,
		CreatedAt: t.CreatedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt: t.UpdatedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
	}
	if t.PublishedVersionID.Valid {
		proto.PublishedVersionId = t.PublishedVersionID.UUID.String()
	}
	return proto
}

func pageVersionFromModel(v dbmodels.PageVersion) *publirattypesv1.PageVersion {
	proto := &publirattypesv1.PageVersion{
		Id:              v.ID.String(),
		PageId:          v.PageID.String(),
		VersionNumber:   v.VersionNumber,
		ContentMarkdown: v.ContentMarkdown,
		Status:          v.Status,
		CreatedAt:       v.CreatedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
	}
	if v.AuthorUserID.Valid {
		proto.AuthorUserId = v.AuthorUserID.UUID.String()
	}
	if v.PublishAt.Valid {
		proto.PublishAt = v.PublishAt.Time.UTC().Format("2006-01-02T15:04:05Z07:00")
	}
	if v.PublishedAt.Valid {
		proto.PublishedAt = v.PublishedAt.Time.UTC().Format("2006-01-02T15:04:05Z07:00")
	}
	return proto
}

// normalizePageSlugForStorage canonicalizes page slugs for DB storage:
//   - trim whitespace
//   - empty / "/" → ""
//   - strip leading/trailing slashes, collapse "//"
//   - each path segment: [a-z0-9][a-z0-9-]*
//   - the first segment is not one pageslug reserves or finds unreachable
//   - stored form always has a single leading "/" (e.g. "/privacy", "/legal/terms")
func normalizePageSlugForStorage(slug string) (string, error) {
	normalized := strings.TrimSpace(slug)
	if normalized == "" || normalized == "/" {
		return "", nil
	}

	// Collapse repeated slashes, then strip outer slashes for segment checks.
	for strings.Contains(normalized, "//") {
		normalized = strings.ReplaceAll(normalized, "//", "/")
	}
	normalized = strings.Trim(normalized, "/")
	if normalized == "" {
		return "", nil
	}

	if len(normalized) > slugMaxLen {
		return "", rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, fmt.Errorf("slug must not exceed %d characters", slugMaxLen), "slug")
	}

	segments := strings.Split(normalized, "/")
	for _, segment := range segments {
		if segment == "" || !slugSegmentPattern.MatchString(segment) {
			return "", rpcerrors.NewFieldViolationError(
				connect.CodeInvalidArgument,
				errors.New("slug must be empty or path segments of lowercase letters, digits, and hyphens (optionally starting with /)"),
				"slug",
			)
		}
	}

	if first, reserved := pageslug.ReservedFirstSegment("/" + normalized); reserved {
		return "", rpcerrors.NewFieldViolationErrorWithReason(
			connect.CodeInvalidArgument,
			fmt.Errorf("slug must not start with /%s, which the public site keeps for its own screen", first),
			"slug",
			rpcerrors.FieldReasonPageSlugReserved,
		)
	}
	if first, unreachable := pageslug.UnreachableFirstSegment("/" + normalized); unreachable {
		return "", rpcerrors.NewFieldViolationErrorWithReason(
			connect.CodeInvalidArgument,
			fmt.Errorf("slug must not start with /%s, which the public site answers before it looks at pages", first),
			"slug",
			rpcerrors.FieldReasonPageSlugUnreachable,
		)
	}

	return "/" + normalized, nil
}

func validateSlug(slug string) (string, error) {
	return normalizePageSlugForStorage(slug)
}

func validatePageTitle(title string) (string, error) {
	normalized := strings.TrimSpace(title)
	if normalized == "" {
		return "", connect.NewError(connect.CodeInvalidArgument, errors.New("title is required"))
	}
	return normalized, nil
}

// pageRevalidateTags names the public caches a published page appears in. The
// site read is among them because GetTenant links the terms and privacy pages
// by slug and title, and only while they are published.
func pageRevalidateTags(tenantID, pageID uuid.UUID) []string {
	return []string{
		fmt.Sprintf("tenant:%s:pages", tenantID.String()),
		fmt.Sprintf("tenant:%s:pages:%s", tenantID.String(), pageID.String()),
		fmt.Sprintf("tenant:%s:site", tenantID.String()),
	}
}

func parsePageID(raw string) (uuid.UUID, error) {
	id, err := uuid.Parse(strings.TrimSpace(raw))
	if err != nil {
		return uuid.Nil, connect.NewError(connect.CodeInvalidArgument, errors.New("page_id is invalid"))
	}
	return id, nil
}

func parseVersionID(raw string) (uuid.UUID, error) {
	id, err := uuid.Parse(strings.TrimSpace(raw))
	if err != nil {
		return uuid.Nil, connect.NewError(connect.CodeInvalidArgument, errors.New("version_id is invalid"))
	}
	return id, nil
}

func (s *adminServer) CreatePage(
	ctx context.Context,
	req *connect.Request[publiraadminv1.CreatePageRequest],
) (*connect.Response[publiraadminv1.CreatePageResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	slug, err := validateSlug(req.Msg.Slug)
	if err != nil {
		return nil, err
	}
	title, err := validatePageTitle(req.Msg.Title)
	if err != nil {
		return nil, err
	}
	pageID, err := uuid.NewV7()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	translationID, err := uuid.NewV7()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin create page transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txCtx := rpcmiddleware.WithTenantQueries(ctx, dbmodels.New(tx))

	page, err := s.queriesFor(txCtx).CreatePage(txCtx, dbmodels.CreatePageParams{
		ID:              pageID,
		TenantID:        tenant.ID,
		Slug:            slug,
		DisplayInFooter: req.Msg.DisplayInFooter,
	})
	if err != nil {
		if strings.Contains(err.Error(), "unique") || strings.Contains(err.Error(), "duplicate") {
			return nil, connect.NewError(connect.CodeAlreadyExists, errors.New("a page with this slug already exists"))
		}
		return nil, s.internalDBError(ctx, "failed to create page", err, "tenant_id", tenant.ID.String())
	}
	translation, err := s.queriesFor(txCtx).CreatePageTranslation(txCtx, dbmodels.CreatePageTranslationParams{
		ID:       translationID,
		PageID:   page.ID,
		TenantID: tenant.ID,
		Locale:   tenant.DefaultLocale,
		Title:    title,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to create page translation", err, "tenant_id", tenant.ID.String(), "page_id", page.ID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit create page", err, "tenant_id", tenant.ID.String(), "page_id", page.ID.String())
	}
	s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    tenant.ID,
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		Action:      "page_created",
		TargetType:  "page",
		TargetID:    page.ID.String(),
		Outcome:     auditlog.OutcomeSuccess,
		ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
	})
	return connect.NewResponse(&publiraadminv1.CreatePageResponse{
		Page: pageFromModel(page, translation),
	}), nil
}

func (s *adminServer) UpdatePage(
	ctx context.Context,
	req *connect.Request[publiraadminv1.UpdatePageRequest],
) (*connect.Response[publiraadminv1.UpdatePageResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	pageID, err := parsePageID(req.Msg.PageId)
	if err != nil {
		return nil, err
	}
	title, err := validatePageTitle(req.Msg.Title)
	if err != nil {
		return nil, err
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin update page transaction", err, "tenant_id", tenant.ID.String(), "page_id", pageID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txCtx := rpcmiddleware.WithTenantQueries(ctx, dbmodels.New(tx))

	current, err := s.pageTranslation(txCtx, tenant, pageID, req.Msg.Locale, "update page")
	if err != nil {
		return nil, err
	}
	translation, err := s.queriesFor(txCtx).UpdatePageTranslationTitle(txCtx, dbmodels.UpdatePageTranslationTitleParams{
		Title:    title,
		ID:       current.PageTranslation.ID,
		TenantID: tenant.ID,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to update page translation", err, "tenant_id", tenant.ID.String(), "page_id", pageID.String())
	}
	// Only overwrite display_in_footer when the client sets the optional field.
	// Omitted values stay as the existing row (COALESCE in UpdatePage).
	params := dbmodels.UpdatePageParams{
		ID:       pageID,
		TenantID: tenant.ID,
	}
	if req.Msg.DisplayInFooter != nil {
		params.DisplayInFooter = sql.NullBool{Bool: req.Msg.GetDisplayInFooter(), Valid: true}
	}
	page, err := s.queriesFor(txCtx).UpdatePage(txCtx, params)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to update page", err, "tenant_id", tenant.ID.String(), "page_id", pageID.String())
	}
	// Title / display_in_footer can change the public footer link list.
	owed, err := s.recordRevalidation(txCtx, tenant.ID, pageRevalidateTags(tenant.ID, page.ID))
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to record the cache invalidation for the updated page", err, "tenant_id", tenant.ID.String(), "page_id", pageID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit update page", err, "tenant_id", tenant.ID.String(), "page_id", pageID.String())
	}
	s.reval.Send(ctx, owed)
	s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    tenant.ID,
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		Action:      "page_updated",
		TargetType:  "page",
		TargetID:    page.ID.String(),
		Outcome:     auditlog.OutcomeSuccess,
		ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
	})
	return connect.NewResponse(&publiraadminv1.UpdatePageResponse{
		Page: pageFromModel(page, translation),
	}), nil
}

func (s *adminServer) ListPages(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ListPagesRequest],
) (*connect.Response[publiraadminv1.ListPagesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}

	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultPageListLimit, maxPageListLimit)
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

	rows, err := s.pagePage(ctx, tenant, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list pages", err, "tenant_id", tenant.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	pages := make([]*publirattypesv1.Page, 0, len(rows))
	for _, p := range rows {
		pages = append(pages, pageFromModel(p.Page, p.PageTranslation))
	}
	res := &publiraadminv1.ListPagesResponse{
		Pages: pages,
	}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = pagination.EncodeTimeUUID(pagination.Backward, rows[0].Page.CreatedAt, rows[0].Page.ID)
		}
		if hasNext {
			last := rows[len(rows)-1]
			res.NextToken = pagination.EncodeTimeUUID(pagination.Forward, last.Page.CreatedAt, last.Page.ID)
		}
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		res.PreviousToken = pagination.EncodeTimeUUIDRecovery(pagination.Backward, keys.Time, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		res.NextToken = pagination.EncodeTimeUUIDRecovery(pagination.Forward, keys.Time, keys.ID)
	}

	return connect.NewResponse(res), nil
}

func (s *adminServer) GetPage(
	ctx context.Context,
	req *connect.Request[publiraadminv1.GetPageRequest],
) (*connect.Response[publiraadminv1.GetPageResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}
	pageID, err := parsePageID(req.Msg.PageId)
	if err != nil {
		return nil, err
	}
	page, err := s.pageTranslation(ctx, tenant, pageID, req.Msg.Locale, "get page")
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&publiraadminv1.GetPageResponse{
		Page: pageFromModel(page.Page, page.PageTranslation),
	}), nil
}

func (s *adminServer) CreateVersion(
	ctx context.Context,
	req *connect.Request[publiraadminv1.CreateVersionRequest],
) (*connect.Response[publiraadminv1.CreateVersionResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	pageID, err := parsePageID(req.Msg.PageId)
	if err != nil {
		return nil, err
	}
	page, err := s.pageTranslation(ctx, tenant, pageID, req.Msg.Locale, "create version")
	if err != nil {
		return nil, err
	}
	maxVersion, err := s.queriesFor(ctx).GetMaxPageVersionNumberByTranslationID(ctx, page.PageTranslation.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get max page version number", err, "tenant_id", tenant.ID.String(), "page_id", pageID.String())
	}
	versionID, err := uuid.NewV7()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	params := dbmodels.CreatePageVersionParams{
		ID:              versionID,
		PageID:          pageID,
		TranslationID:   page.PageTranslation.ID,
		VersionNumber:   maxVersion + 1,
		ContentMarkdown: req.Msg.ContentMarkdown,
	}
	params.AuthorUserID = uuid.NullUUID{UUID: sessionCtx.User.ID, Valid: true}
	params.TenantID = tenant.ID
	version, err := s.queriesFor(ctx).CreatePageVersion(ctx, params)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to create page version", err, "tenant_id", tenant.ID.String(), "page_id", pageID.String())
	}
	s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    tenant.ID,
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		Action:      "page_version_created",
		TargetType:  "page_version",
		TargetID:    version.ID.String(),
		Outcome:     auditlog.OutcomeSuccess,
		ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
	})
	return connect.NewResponse(&publiraadminv1.CreateVersionResponse{
		Version: pageVersionFromModel(version),
	}), nil
}

func (s *adminServer) ListVersions(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ListVersionsRequest],
) (*connect.Response[publiraadminv1.ListVersionsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}
	pageID, err := parsePageID(req.Msg.PageId)
	if err != nil {
		return nil, err
	}
	page, err := s.pageTranslation(ctx, tenant, pageID, req.Msg.Locale, "list versions")
	if err != nil {
		return nil, err
	}
	rows, err := s.queriesFor(ctx).ListPageVersionsByTranslationID(ctx, page.PageTranslation.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list page versions", err, "tenant_id", tenant.ID.String())
	}
	versions := make([]*publirattypesv1.PageVersion, 0, len(rows))
	for _, v := range rows {
		versions = append(versions, pageVersionFromModel(v))
	}
	return connect.NewResponse(&publiraadminv1.ListVersionsResponse{
		Versions: versions,
	}), nil
}

func (s *adminServer) PublishVersion(
	ctx context.Context,
	req *connect.Request[publiraadminv1.PublishVersionRequest],
) (*connect.Response[publiraadminv1.PublishVersionResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	pageID, err := parsePageID(req.Msg.PageId)
	if err != nil {
		return nil, err
	}
	versionID, err := parseVersionID(req.Msg.VersionId)
	if err != nil {
		return nil, err
	}
	page, err := s.pageTranslation(ctx, tenant, pageID, req.Msg.Locale, "publish version")
	if err != nil {
		return nil, err
	}
	var version dbmodels.PageVersion
	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		published, err := s.queriesFor(txCtx).PublishPageVersion(txCtx, dbmodels.PublishPageVersionParams{
			ID:            versionID,
			TranslationID: page.PageTranslation.ID,
		})
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, connect.NewError(connect.CodeNotFound, errors.New("page version not found"))
			}
			return nil, s.internalDBError(ctx, "failed to publish page version", err, "tenant_id", tenant.ID.String(), "page_id", pageID.String(), "version_id", versionID.String())
		}
		if _, err := s.queriesFor(txCtx).SetPageTranslationPublishedVersion(txCtx, dbmodels.SetPageTranslationPublishedVersionParams{
			ID:                 page.PageTranslation.ID,
			TenantID:           tenant.ID,
			PublishedVersionID: uuid.NullUUID{UUID: published.ID, Valid: true},
		}); err != nil {
			return nil, s.internalDBError(ctx, "failed to set published page version", err, "tenant_id", tenant.ID.String(), "page_id", pageID.String(), "version_id", published.ID.String())
		}
		version = published
		// Tags must use tenant.ID (path / cache key), same as series revalidate.
		return pageRevalidateTags(tenant.ID, published.PageID), nil
	}); err != nil {
		return nil, err
	}
	s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    tenant.ID,
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		Action:      "page_version_published",
		TargetType:  "page_version",
		TargetID:    version.ID.String(),
		Outcome:     auditlog.OutcomeSuccess,
		ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
	})
	return connect.NewResponse(&publiraadminv1.PublishVersionResponse{
		Version: pageVersionFromModel(version),
	}), nil
}

// UnpublishPage takes a page off the public site by clearing its published
// version. It is idempotent: an already unpublished page is answered the same
// way, because the operator's intent — this must not be served — holds either
// way. The page_versions rows are untouched, so PublishVersion puts the same
// body back up without it being entered again.
func (s *adminServer) UnpublishPage(
	ctx context.Context,
	req *connect.Request[publiraadminv1.UnpublishPageRequest],
) (*connect.Response[publiraadminv1.UnpublishPageResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	pageID, err := parsePageID(req.Msg.PageId)
	if err != nil {
		return nil, err
	}
	page, err := s.pageTranslation(ctx, tenant, pageID, req.Msg.Locale, "unpublish page")
	if err != nil {
		return nil, err
	}
	var translation dbmodels.PageTranslation
	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		row, err := s.queriesFor(txCtx).SetPageTranslationPublishedVersion(txCtx, dbmodels.SetPageTranslationPublishedVersionParams{
			ID:                 page.PageTranslation.ID,
			TenantID:           tenant.ID,
			PublishedVersionID: uuid.NullUUID{},
		})
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, connect.NewError(connect.CodeNotFound, errors.New("page not found"))
			}
			return nil, s.internalDBError(ctx, "failed to unpublish page", err, "tenant_id", tenant.ID.String(), "page_id", pageID.String())
		}
		translation = row
		// Both the page's own URL and the footer link list have to stop serving it.
		return pageRevalidateTags(tenant.ID, page.Page.ID), nil
	}); err != nil {
		return nil, err
	}
	s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    tenant.ID,
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		Action:      "page_unpublished",
		TargetType:  "page",
		TargetID:    page.Page.ID.String(),
		Outcome:     auditlog.OutcomeSuccess,
		ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
	})
	return connect.NewResponse(&publiraadminv1.UnpublishPageResponse{
		Page: pageFromModel(page.Page, translation),
	}), nil
}

func (s *adminServer) RollbackToVersion(
	ctx context.Context,
	req *connect.Request[publiraadminv1.RollbackToVersionRequest],
) (*connect.Response[publiraadminv1.RollbackToVersionResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	pageID, err := parsePageID(req.Msg.PageId)
	if err != nil {
		return nil, err
	}
	versionID, err := parseVersionID(req.Msg.VersionId)
	if err != nil {
		return nil, err
	}
	page, err := s.pageTranslation(ctx, tenant, pageID, req.Msg.Locale, "rollback")
	if err != nil {
		return nil, err
	}
	// Fetch the target version to copy its content
	target, err := s.queriesFor(ctx).GetPageVersionByIDForTranslation(ctx, dbmodels.GetPageVersionByIDForTranslationParams{
		ID:            versionID,
		TranslationID: page.PageTranslation.ID,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("page version not found"))
		}
		return nil, s.internalDBError(ctx, "failed to get page version for rollback", err, "tenant_id", tenant.ID.String(), "page_id", pageID.String(), "version_id", versionID.String())
	}
	maxVersion, err := s.queriesFor(ctx).GetMaxPageVersionNumberByTranslationID(ctx, page.PageTranslation.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get max page version number for rollback", err, "tenant_id", tenant.ID.String(), "page_id", pageID.String())
	}
	newVersionID, err := uuid.NewV7()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	params := dbmodels.CreatePageVersionParams{
		ID:              newVersionID,
		PageID:          pageID,
		TranslationID:   page.PageTranslation.ID,
		VersionNumber:   maxVersion + 1,
		ContentMarkdown: target.ContentMarkdown,
	}
	params.AuthorUserID = uuid.NullUUID{UUID: sessionCtx.User.ID, Valid: true}
	params.TenantID = tenant.ID
	newVersion, err := s.queriesFor(ctx).CreatePageVersion(ctx, params)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to create rollback page version", err, "tenant_id", tenant.ID.String(), "page_id", pageID.String())
	}
	s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    tenant.ID,
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		Action:      "page_version_rolled_back",
		TargetType:  "page_version",
		TargetID:    newVersion.ID.String(),
		Outcome:     auditlog.OutcomeSuccess,
		ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
	})
	return connect.NewResponse(&publiraadminv1.RollbackToVersionResponse{
		Version: pageVersionFromModel(newVersion),
	}), nil
}

func (s *adminServer) CreatePageTranslation(
	ctx context.Context,
	req *connect.Request[publiraadminv1.CreatePageTranslationRequest],
) (*connect.Response[publiraadminv1.CreatePageTranslationResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	pageID, err := parsePageID(req.Msg.PageId)
	if err != nil {
		return nil, err
	}
	code, err := parsePageLocale(req.Msg.Locale)
	if err != nil {
		return nil, err
	}
	title, err := validatePageTitle(req.Msg.Title)
	if err != nil {
		return nil, err
	}
	if _, err := s.getPage(ctx, tenant, pageID, "create page translation"); err != nil {
		return nil, err
	}
	translationID, err := uuid.NewV7()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	translation, err := s.queriesFor(ctx).CreatePageTranslation(ctx, dbmodels.CreatePageTranslationParams{
		ID:       translationID,
		PageID:   pageID,
		TenantID: tenant.ID,
		Locale:   code,
		Title:    title,
	})
	if err != nil {
		if strings.Contains(err.Error(), "page_translations_page_id_locale_key") {
			return nil, connect.NewError(connect.CodeAlreadyExists, errors.New("the page already has a translation in this locale"))
		}
		return nil, s.internalDBError(ctx, "failed to create page translation", err, "tenant_id", tenant.ID.String(), "page_id", pageID.String(), "locale", code)
	}
	s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    tenant.ID,
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		Action:      "page_translation_created",
		TargetType:  "page_translation",
		TargetID:    translation.ID.String(),
		Outcome:     auditlog.OutcomeSuccess,
		ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
	})
	return connect.NewResponse(&publiraadminv1.CreatePageTranslationResponse{
		Translation: pageTranslationFromModel(translation),
	}), nil
}

func (s *adminServer) ListPageTranslations(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ListPageTranslationsRequest],
) (*connect.Response[publiraadminv1.ListPageTranslationsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}
	pageID, err := parsePageID(req.Msg.PageId)
	if err != nil {
		return nil, err
	}
	rows, err := s.queriesFor(ctx).ListPageTranslationsForTenant(ctx, dbmodels.ListPageTranslationsForTenantParams{
		PageID:   pageID,
		TenantID: tenant.ID,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list page translations", err, "tenant_id", tenant.ID.String(), "page_id", pageID.String())
	}
	if len(rows) == 0 {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("page not found"))
	}
	translations := make([]*publirattypesv1.PageTranslation, 0, len(rows))
	for _, row := range rows {
		translations = append(translations, pageTranslationFromModel(row))
	}
	return connect.NewResponse(&publiraadminv1.ListPageTranslationsResponse{
		Translations: translations,
	}), nil
}

func (s *adminServer) DeletePageTranslation(
	ctx context.Context,
	req *connect.Request[publiraadminv1.DeletePageTranslationRequest],
) (*connect.Response[publiraadminv1.DeletePageTranslationResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	pageID, err := parsePageID(req.Msg.PageId)
	if err != nil {
		return nil, err
	}
	code, err := parsePageLocale(req.Msg.Locale)
	if err != nil {
		return nil, err
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin delete page translation transaction", err, "tenant_id", tenant.ID.String(), "page_id", pageID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txCtx := rpcmiddleware.WithTenantQueries(ctx, dbmodels.New(tx))
	queries := s.queriesFor(txCtx)

	// The lock keeps two deletions from each seeing the other's translation
	// still there and together leaving the page with none.
	if _, err := queries.LockPageForTenant(txCtx, dbmodels.LockPageForTenantParams{ID: pageID, TenantID: tenant.ID}); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("page not found"))
		}
		return nil, s.internalDBError(ctx, "failed to lock page for translation deletion", err, "tenant_id", tenant.ID.String(), "page_id", pageID.String())
	}
	target, err := s.pageTranslation(txCtx, tenant, pageID, code, "delete page translation")
	if err != nil {
		return nil, err
	}
	count, err := queries.CountPageTranslations(txCtx, pageID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to count page translations", err, "tenant_id", tenant.ID.String(), "page_id", pageID.String())
	}
	if count <= 1 {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("a page must keep at least one translation"))
	}
	if _, err := queries.DeletePageTranslation(txCtx, dbmodels.DeletePageTranslationParams{
		ID:       target.PageTranslation.ID,
		TenantID: tenant.ID,
	}); err != nil {
		return nil, s.internalDBError(ctx, "failed to delete page translation", err, "tenant_id", tenant.ID.String(), "page_id", pageID.String(), "locale", code)
	}
	// The translation may have been the one a locale was served.
	owed, err := s.recordRevalidation(txCtx, tenant.ID, pageRevalidateTags(tenant.ID, pageID))
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to record the cache invalidation for the deleted page translation", err, "tenant_id", tenant.ID.String(), "page_id", pageID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit delete page translation", err, "tenant_id", tenant.ID.String(), "page_id", pageID.String())
	}
	s.reval.Send(ctx, owed)
	s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    tenant.ID,
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		Action:      "page_translation_deleted",
		TargetType:  "page_translation",
		TargetID:    target.PageTranslation.ID.String(),
		Outcome:     auditlog.OutcomeSuccess,
		ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
	})
	return connect.NewResponse(&publiraadminv1.DeletePageTranslationResponse{}), nil
}
