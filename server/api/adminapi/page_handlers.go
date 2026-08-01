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

	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db"
)

var slugPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9\-]*$`)

const slugMaxLen = 255

func pageFromModel(p dbmodels.Page) *publirattypesv1.Page {
	proto := &publirattypesv1.Page{
		Id:        p.ID.String(),
		Slug:      p.Slug,
		Title:     p.Title,
		CreatedAt: p.CreatedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt: p.UpdatedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
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

func validateSlug(slug string) (string, error) {
	normalized := strings.TrimSpace(slug)
	if normalized == "" || normalized == "/" {
		return "", nil
	}
	normalized = strings.TrimPrefix(normalized, "/")
	if len(normalized) > slugMaxLen {
		return "", connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("slug must not exceed %d characters", slugMaxLen))
	}
	if !slugPattern.MatchString(normalized) {
		return "", connect.NewError(connect.CodeInvalidArgument, errors.New("slug must be empty or contain only lowercase letters, digits, and hyphens, and may optionally start with /"))
	}
	return "/" + normalized, nil
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
		ID:       pageID,
		TenantID: tenant.ID,
		Slug:     slug,
		Title:    title,
	})
	if err != nil {
		if strings.Contains(err.Error(), "unique") || strings.Contains(err.Error(), "duplicate") {
			return nil, connect.NewError(connect.CodeAlreadyExists, errors.New("a page with this slug already exists"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	s.recorder.RecordTenant(ctx, auditlog.TenantEntry{
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
	page, err := s.queriesFor(ctx).UpdatePageTitle(ctx, dbmodels.UpdatePageTitleParams{
		ID:       pageID,
		TenantID: tenant.ID,
		Title:    title,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("page not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	s.recorder.RecordTenant(ctx, auditlog.TenantEntry{
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
	rows, err := s.queriesFor(ctx).ListPagesForTenant(ctx, tenant.ID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	pages := make([]*publirattypesv1.Page, 0, len(rows))
	for _, p := range rows {
		pages = append(pages, pageFromModel(p))
	}
	return connect.NewResponse(&publiraadminv1.ListPagesResponse{
		Pages: pages,
	}), nil
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
		return nil, connect.NewError(connect.CodeInternal, err)
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
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	maxVersion, err := s.queriesFor(ctx).GetMaxPageVersionNumberByPageID(ctx, pageID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
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
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	s.recorder.RecordTenant(ctx, auditlog.TenantEntry{
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
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	rows, err := s.queriesFor(ctx).ListPageVersionsByPageID(ctx, pageID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
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
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	version, err := s.queriesFor(ctx).PublishPageVersion(ctx, dbmodels.PublishPageVersionParams{
		ID:     versionID,
		PageID: pageID,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("page version not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	// Update the page's published_version_id
	if _, err := s.queriesFor(ctx).SetPagePublishedVersion(ctx, dbmodels.SetPagePublishedVersionParams{
		ID:                 pageID,
		TenantID:           tenant.ID,
		PublishedVersionID: uuid.NullUUID{UUID: version.ID, Valid: true},
	}); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	s.recorder.RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    tenant.ID,
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		Action:      "page_version_published",
		TargetType:  "page_version",
		TargetID:    version.ID.String(),
		Outcome:     auditlog.OutcomeSuccess,
		ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
	})
	// Trigger revalidation for the page on the public site
	if s.reval != nil {
		tags := []string{
			fmt.Sprintf("tenant:%s:pages", tenant.PublicID),
			fmt.Sprintf("tenant:%s:pages:%s", tenant.PublicID, version.PageID.String()),
		}
		if err := s.reval.RevalidateTags(ctx, tenant.PublicID, tenant.Domain, tags); err != nil {
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
		return nil, connect.NewError(connect.CodeInternal, err)
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
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	maxVersion, err := s.queriesFor(ctx).GetMaxPageVersionNumberByPageID(ctx, pageID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
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
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	s.recorder.RecordTenant(ctx, auditlog.TenantEntry{
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
