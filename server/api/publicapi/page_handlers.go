package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"connectrpc.com/connect"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/locale"
	"github.com/publira/publira/server/internal/pageslug"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
)

func pageFromPublishedModel(p dbmodels.Page, t dbmodels.PageTranslation) *publirattypesv1.Page {
	updatedAt := p.UpdatedAt
	if t.UpdatedAt.After(updatedAt) {
		updatedAt = t.UpdatedAt
	}
	item := &publirattypesv1.Page{
		Id:              p.ID.String(),
		Slug:            p.Slug,
		Title:           t.Title,
		CreatedAt:       p.CreatedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt:       updatedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
		DisplayInFooter: p.DisplayInFooter,
		Locale:          t.Locale,
	}
	if t.PublishedVersionID.Valid {
		item.PublishedVersionId = t.PublishedVersionID.UUID.String()
	}
	return item
}

func pageVersionFromPublishedRow(row dbmodels.GetPublishedPageBySlugForTenantRow) *publirattypesv1.PageVersion {
	item := &publirattypesv1.PageVersion{
		Id:              row.VersionID.String(),
		PageId:          row.PageID.String(),
		VersionNumber:   row.VersionNumber,
		ContentMarkdown: row.ContentMarkdown,
		Status:          row.Status,
		CreatedAt:       row.VersionCreatedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
	}
	if row.AuthorUserID.Valid {
		item.AuthorUserId = row.AuthorUserID.UUID.String()
	}
	if row.PublishAt.Valid {
		item.PublishAt = row.PublishAt.Time.UTC().Format("2006-01-02T15:04:05Z07:00")
	}
	if row.PublishedAt.Valid {
		item.PublishedAt = row.PublishedAt.Time.UTC().Format("2006-01-02T15:04:05Z07:00")
	}
	return item
}

// readerPageLocale is the locale a reader asked to read pages in: the tenant's
// default for an empty value, since that is what the unprefixed public URLs
// are served in.
func readerPageLocale(raw string, tenant dbmodels.Tenant) (string, error) {
	if strings.TrimSpace(raw) == "" {
		return tenant.DefaultLocale, nil
	}
	code, err := locale.Normalize(raw)
	if err != nil {
		return "", connect.NewError(connect.CodeInvalidArgument, errors.New("locale must be a supported locale"))
	}
	return code, nil
}

func (s *apiServer) ListPublishedPages(
	ctx context.Context,
	req *connect.Request[publirav1.ListPublishedPagesRequest],
) (*connect.Response[publirav1.ListPublishedPagesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}

	readerLocale, err := readerPageLocale(req.Msg.Locale, tenant)
	if err != nil {
		return nil, err
	}

	rows, err := s.queriesFor(ctx).ListPublishedPagesForTenant(ctx, dbmodels.ListPublishedPagesForTenantParams{
		TenantID: tenant.ID,
		Locale:   readerLocale,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list published pages", err, "tenant_id", tenant.ID.String())
	}

	pages := make([]*publirattypesv1.Page, 0, len(rows))
	for _, row := range rows {
		pages = append(pages, pageFromPublishedModel(row.Page, row.PageTranslation))
	}

	return connect.NewResponse(&publirav1.ListPublishedPagesResponse{Pages: pages}), nil
}

func (s *apiServer) ListPublishedPageSlugs(
	ctx context.Context,
	req *connect.Request[publirav1.ListPublishedPageSlugsRequest],
) (*connect.Response[publirav1.ListPublishedPageSlugsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}

	rows, err := s.queriesFor(ctx).ListPublishedPageSlugsForTenant(ctx, tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list published page slugs", err, "tenant_id", tenant.ID.String())
	}

	// The admin API refuses these slugs, but a row stored before it did (or
	// written past it) must still never be routed over a reserved screen.
	slugs := make([]string, 0, len(rows))
	for _, slug := range rows {
		if _, reserved := pageslug.ReservedFirstSegment(slug); !reserved {
			slugs = append(slugs, slug)
		}
	}

	return connect.NewResponse(&publirav1.ListPublishedPageSlugsResponse{Slugs: slugs}), nil
}

// normalizePublishedPageSlugLookup matches admin storage form so clients may
// send "privacy", "/privacy", or "//privacy" and still hit the same row.
func normalizePublishedPageSlugLookup(slug string) string {
	normalized := strings.TrimSpace(slug)
	if normalized == "" || normalized == "/" {
		return ""
	}
	for strings.Contains(normalized, "//") {
		normalized = strings.ReplaceAll(normalized, "//", "/")
	}
	normalized = strings.Trim(normalized, "/")
	if normalized == "" {
		return ""
	}
	return "/" + normalized
}

func (s *apiServer) GetPublishedPage(
	ctx context.Context,
	req *connect.Request[publirav1.GetPublishedPageRequest],
) (*connect.Response[publirav1.GetPublishedPageResponse], error) {
	slug := normalizePublishedPageSlugLookup(req.Msg.Slug)
	if slug == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("slug is required"))
	}

	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}

	readerLocale, err := readerPageLocale(req.Msg.Locale, tenant)
	if err != nil {
		return nil, err
	}

	row, err := s.queriesFor(ctx).GetPublishedPageBySlugForTenant(ctx, dbmodels.GetPublishedPageBySlugForTenantParams{
		TenantID: tenant.ID,
		Slug:     slug,
		Locale:   readerLocale,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("page not found"))
		}
		return nil, s.internalDBError(ctx, "failed to get published page", err, "tenant_id", tenant.ID.String(), "slug", slug)
	}

	return connect.NewResponse(&publirav1.GetPublishedPageResponse{
		Page: pageFromPublishedModel(dbmodels.Page{
			ID:              row.ID,
			TenantID:        row.TenantID,
			Slug:            row.Slug,
			DisplayInFooter: row.DisplayInFooter,
			CreatedAt:       row.CreatedAt,
			UpdatedAt:       row.UpdatedAt,
		}, dbmodels.PageTranslation{
			Locale:             row.Locale,
			Title:              row.Title,
			PublishedVersionID: row.PublishedVersionID,
			UpdatedAt:          row.TranslationUpdatedAt,
		}),
		Version:          pageVersionFromPublishedRow(row),
		PublishedLocales: row.PublishedLocales,
	}), nil
}
