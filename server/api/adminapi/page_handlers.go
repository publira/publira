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
	"github.com/publira/publira/server/internal/pagination"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
)

var slugSegmentPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9\-]*$`)

const (
	slugMaxLen           = 255
	defaultPageListLimit = int32(20)
	maxPageListLimit     = int32(100)
)

func (s *adminServer) pagePage(
	ctx context.Context,
	tenantID uuid.UUID,
	keys pagination.TimeUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]dbmodels.Page, error) {
	queries := s.queriesFor(ctx)
	if direction == pagination.Backward {
		return queries.ListPagesForTenantDesc(ctx, dbmodels.ListPagesForTenantDescParams{
			TenantID:        tenantID,
			CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
			CursorInclusive: keys.Inclusive,
			CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
			Limit:           limit,
		})
	}

	return queries.ListPagesForTenantAsc(ctx, dbmodels.ListPagesForTenantAscParams{
		TenantID:        tenantID,
		CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
		CursorInclusive: keys.Inclusive,
		CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
		Limit:           limit,
	})
}

func pageFromModel(p dbmodels.Page) *publirattypesv1.Page {
	proto := &publirattypesv1.Page{
		Id:              p.ID.String(),
		Slug:            p.Slug,
		Title:           p.Title,
		CreatedAt:       p.CreatedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt:       p.UpdatedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
		DisplayInFooter: p.DisplayInFooter,
	}
	if p.PublishedVersionID.Valid {
		proto.PublishedVersionId = p.PublishedVersionID.UUID.String()
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
	page, err := s.queriesFor(ctx).CreatePage(ctx, dbmodels.CreatePageParams{
		ID:              pageID,
		TenantID:        tenant.ID,
		Slug:            slug,
		Title:           title,
		DisplayInFooter: req.Msg.DisplayInFooter,
	})
	if err != nil {
		if strings.Contains(err.Error(), "unique") || strings.Contains(err.Error(), "duplicate") {
			return nil, connect.NewError(connect.CodeAlreadyExists, errors.New("a page with this slug already exists"))
		}
		return nil, s.internalDBError(ctx, "failed to create page", err, "tenant_id", tenant.ID.String())
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
		Page: pageFromModel(page),
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
	// Only overwrite display_in_footer when the client sets the optional field.
	// Omitted values stay as the existing row (COALESCE in UpdatePage).
	params := dbmodels.UpdatePageParams{
		ID:       pageID,
		TenantID: tenant.ID,
		Title:    title,
	}
	if req.Msg.DisplayInFooter != nil {
		params.DisplayInFooter = sql.NullBool{Bool: req.Msg.GetDisplayInFooter(), Valid: true}
	}
	page, err := s.queriesFor(ctx).UpdatePage(ctx, params)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("page not found"))
		}
		return nil, s.internalDBError(ctx, "failed to update page", err, "tenant_id", tenant.ID.String(), "page_id", pageID.String())
	}
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
	// Title / display_in_footer can change the public footer link list.
	if s.reval != nil {
		tenantID := tenant.ID.String()
		tags := []string{
			fmt.Sprintf("tenant:%s:pages", tenantID),
			fmt.Sprintf("tenant:%s:pages:%s", tenantID, page.ID.String()),
		}
		if err := s.reval.RevalidateTags(ctx, tags); err != nil {
			s.logger.Warn("failed to request next revalidate after page update", "tenant_public_id", tenant.PublicID, "page_id", pageID, "error", err)
		}
	}
	return connect.NewResponse(&publiraadminv1.UpdatePageResponse{
		Page: pageFromModel(page),
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

	rows, err := s.pagePage(ctx, tenant.ID, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list pages", err, "tenant_id", tenant.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	pages := make([]*publirattypesv1.Page, 0, len(rows))
	for _, p := range rows {
		pages = append(pages, pageFromModel(p))
	}
	res := &publiraadminv1.ListPagesResponse{
		Pages: pages,
	}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = pagination.EncodeTimeUUID(pagination.Backward, rows[0].CreatedAt, rows[0].ID)
		}
		if hasNext {
			last := rows[len(rows)-1]
			res.NextToken = pagination.EncodeTimeUUID(pagination.Forward, last.CreatedAt, last.ID)
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
	page, err := s.queriesFor(ctx).GetPageByIDForTenant(ctx, dbmodels.GetPageByIDForTenantParams{
		ID:       pageID,
		TenantID: tenant.ID,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("page not found"))
		}
		return nil, s.internalDBError(ctx, "failed to get page", err, "tenant_id", tenant.ID.String(), "page_id", pageID.String())
	}
	return connect.NewResponse(&publiraadminv1.GetPageResponse{
		Page: pageFromModel(page),
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
	// Verify the page belongs to this tenant
	if _, err := s.queriesFor(ctx).GetPageByIDForTenant(ctx, dbmodels.GetPageByIDForTenantParams{
		ID:       pageID,
		TenantID: tenant.ID,
	}); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("page not found"))
		}
		return nil, s.internalDBError(ctx, "failed to get page for create version", err, "tenant_id", tenant.ID.String(), "page_id", pageID.String())
	}
	maxVersion, err := s.queriesFor(ctx).GetMaxPageVersionNumberByPageID(ctx, pageID)
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
	// Verify the page belongs to this tenant
	if _, err := s.queriesFor(ctx).GetPageByIDForTenant(ctx, dbmodels.GetPageByIDForTenantParams{
		ID:       pageID,
		TenantID: tenant.ID,
	}); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("page not found"))
		}
		return nil, s.internalDBError(ctx, "failed to get page for list versions", err, "tenant_id", tenant.ID.String())
	}
	rows, err := s.queriesFor(ctx).ListPageVersionsByPageID(ctx, pageID)
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
	// Verify the page belongs to this tenant
	if _, err := s.queriesFor(ctx).GetPageByIDForTenant(ctx, dbmodels.GetPageByIDForTenantParams{
		ID:       pageID,
		TenantID: tenant.ID,
	}); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("page not found"))
		}
		return nil, s.internalDBError(ctx, "failed to get page for publish version", err, "tenant_id", tenant.ID.String(), "page_id", pageID.String())
	}
	version, err := s.queriesFor(ctx).PublishPageVersion(ctx, dbmodels.PublishPageVersionParams{
		ID:     versionID,
		PageID: pageID,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("page version not found"))
		}
		return nil, s.internalDBError(ctx, "failed to publish page version", err, "tenant_id", tenant.ID.String(), "page_id", pageID.String(), "version_id", versionID.String())
	}
	// Update the page's published_version_id
	if _, err := s.queriesFor(ctx).SetPagePublishedVersion(ctx, dbmodels.SetPagePublishedVersionParams{
		ID:                 pageID,
		TenantID:           tenant.ID,
		PublishedVersionID: uuid.NullUUID{UUID: version.ID, Valid: true},
	}); err != nil {
		return nil, s.internalDBError(ctx, "failed to set published page version", err, "tenant_id", tenant.ID.String(), "page_id", pageID.String(), "version_id", version.ID.String())
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
	// Trigger revalidation for the page on the public site.
	// Tags must use tenant.ID (path / cache key), same as series revalidate.
	if s.reval != nil {
		tenantID := tenant.ID.String()
		tags := []string{
			fmt.Sprintf("tenant:%s:pages", tenantID),
			fmt.Sprintf("tenant:%s:pages:%s", tenantID, version.PageID.String()),
		}
		if err := s.reval.RevalidateTags(ctx, tags); err != nil {
			s.logger.Warn("failed to request next revalidate after page publish", "tenant_public_id", tenant.PublicID, "page_id", pageID, "error", err)
		}
	}
	return connect.NewResponse(&publiraadminv1.PublishVersionResponse{
		Version: pageVersionFromModel(version),
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
	// Verify the page belongs to this tenant
	if _, err := s.queriesFor(ctx).GetPageByIDForTenant(ctx, dbmodels.GetPageByIDForTenantParams{
		ID:       pageID,
		TenantID: tenant.ID,
	}); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("page not found"))
		}
		return nil, s.internalDBError(ctx, "failed to get page for rollback", err, "tenant_id", tenant.ID.String(), "page_id", pageID.String())
	}
	// Fetch the target version to copy its content
	target, err := s.queriesFor(ctx).GetPageVersionByIDForPage(ctx, dbmodels.GetPageVersionByIDForPageParams{
		ID:     versionID,
		PageID: pageID,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("page version not found"))
		}
		return nil, s.internalDBError(ctx, "failed to get page version for rollback", err, "tenant_id", tenant.ID.String(), "page_id", pageID.String(), "version_id", versionID.String())
	}
	maxVersion, err := s.queriesFor(ctx).GetMaxPageVersionNumberByPageID(ctx, pageID)
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
		VersionNumber:   maxVersion + 1,
		ContentMarkdown: target.ContentMarkdown,
	}
	params.AuthorUserID = uuid.NullUUID{UUID: sessionCtx.User.ID, Valid: true}
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
