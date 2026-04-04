package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"connectrpc.com/connect"

	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/gen/publira/v1"
	dbmodels "github.com/publira/publira/server/internal/db"
)

func pageFromPublishedModel(p dbmodels.Page) *publirattypesv1.Page {
	item := &publirattypesv1.Page{
		Id:        p.ID.String(),
		Slug:      p.Slug,
		Title:     p.Title,
		CreatedAt: p.CreatedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt: p.UpdatedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
	}
	if p.PublishedVersionID.Valid {
		item.PublishedVersionId = p.PublishedVersionID.UUID.String()
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

func (s *apiServer) ListPublishedPages(
	ctx context.Context,
	req *connect.Request[publirav1.ListPublishedPagesRequest],
) (*connect.Response[publirav1.ListPublishedPagesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}

	rows, err := s.queriesFor(ctx).ListPublishedPagesForTenant(ctx, tenant.ID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	pages := make([]*publirattypesv1.Page, 0, len(rows))
	for _, row := range rows {
		pages = append(pages, pageFromPublishedModel(row))
	}

	return connect.NewResponse(&publirav1.ListPublishedPagesResponse{Pages: pages}), nil
}

func (s *apiServer) GetPublishedPage(
	ctx context.Context,
	req *connect.Request[publirav1.GetPublishedPageRequest],
) (*connect.Response[publirav1.GetPublishedPageResponse], error) {
	slug := strings.TrimSpace(req.Msg.Slug)
	if slug == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("slug is required"))
	}

	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}

	row, err := s.queriesFor(ctx).GetPublishedPageBySlugForTenant(ctx, dbmodels.GetPublishedPageBySlugForTenantParams{
		TenantID: tenant.ID,
		Slug:     slug,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("page not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&publirav1.GetPublishedPageResponse{
		Page: pageFromPublishedModel(dbmodels.Page{
			ID:                 row.ID,
			TenantID:           row.TenantID,
			Slug:               row.Slug,
			Title:              row.Title,
			PublishedVersionID: row.PublishedVersionID,
			CreatedAt:          row.CreatedAt,
			UpdatedAt:          row.UpdatedAt,
		}),
		Version: pageVersionFromPublishedRow(row),
	}), nil
}