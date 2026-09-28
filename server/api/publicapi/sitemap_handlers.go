package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
)

// A sitemap is walked to the end rather than browsed, so a page is as large as
// the limit allows unless the caller asks for less.
const (
	defaultSitemapPageSize = int32(1000)
	maxSitemapPageSize     = int32(1000)
)

// sitemapEntryRow is one row of a sitemap page, shared by the ascending and
// descending keyset queries so the handler reads a single shape.
type sitemapEntryRow struct {
	kind           int32
	id             uuid.UUID
	publicID       string
	seriesPublicID string
	slug           string
	lastModifiedAt sql.NullTime
}

// sitemapEntryPage runs the keyset query for one page. The cursor's count is
// the SitemapEntryKind number of its boundary row, which is the first sort key.
func (s *apiServer) sitemapEntryPage(
	ctx context.Context,
	tenantID uuid.UUID,
	surface string,
	keys pagination.CountUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]sitemapEntryRow, error) {
	queries := s.queriesFor(ctx)
	cursorID := uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid}
	cursorKind := sql.NullInt32{Int32: int32(keys.Count), Valid: keys.Valid}
	if direction == pagination.Backward {
		rows, err := queries.ListSitemapEntriesDesc(ctx, dbmodels.ListSitemapEntriesDescParams{
			TenantID:        tenantID,
			Surface:         surface,
			CursorID:        cursorID,
			CursorInclusive: keys.Inclusive,
			CursorKind:      cursorKind,
			Limit:           limit,
		})
		if err != nil {
			return nil, err
		}
		page := make([]sitemapEntryRow, 0, len(rows))
		for _, row := range rows {
			page = append(page, sitemapEntryRow{
				kind:           row.Kind,
				id:             row.ID,
				publicID:       row.PublicID,
				seriesPublicID: row.SeriesPublicID,
				slug:           row.Slug,
				lastModifiedAt: row.LastModifiedAt,
			})
		}
		return page, nil
	}

	rows, err := queries.ListSitemapEntriesAsc(ctx, dbmodels.ListSitemapEntriesAscParams{
		TenantID:        tenantID,
		Surface:         surface,
		CursorID:        cursorID,
		CursorInclusive: keys.Inclusive,
		CursorKind:      cursorKind,
		Limit:           limit,
	})
	if err != nil {
		return nil, err
	}
	page := make([]sitemapEntryRow, 0, len(rows))
	for _, row := range rows {
		page = append(page, sitemapEntryRow{
			kind:           row.Kind,
			id:             row.ID,
			publicID:       row.PublicID,
			seriesPublicID: row.SeriesPublicID,
			slug:           row.Slug,
			lastModifiedAt: row.LastModifiedAt,
		})
	}
	return page, nil
}

// ListSitemapEntries hands the storefront every page it publishes for the
// tenant, with the time each last changed, so its sitemap is built from one
// walk rather than from a read per series.
func (s *apiServer) ListSitemapEntries(
	ctx context.Context,
	req *connect.Request[publirav1.ListSitemapEntriesRequest],
) (*connect.Response[publirav1.ListSitemapEntriesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	// A sitemap is read by crawlers of the web storefront, and the app has no
	// URLs of its own to list.
	surface, err := callingSurface(publirattypesv1.ClientSurface_CLIENT_SURFACE_WEB)
	if err != nil {
		return nil, err
	}
	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultSitemapPageSize, maxSitemapPageSize)
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
		// A kind no entry has would compare against a position no row holds.
		if keys.Count < int64(publirav1.SitemapEntryKind_SITEMAP_ENTRY_KIND_SERIES) || keys.Count > int64(publirav1.SitemapEntryKind_SITEMAP_ENTRY_KIND_PAGE) {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
		}
	}

	// One row past the page: its presence is what says another page exists.
	rows, err := s.sitemapEntryPage(ctx, tenant.ID, surface, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list sitemap entries", err, "tenant_id", tenant.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	entries := make([]*publirav1.SitemapEntry, 0, len(rows))
	for _, row := range rows {
		entry := &publirav1.SitemapEntry{
			Kind:           publirav1.SitemapEntryKind(row.kind),
			PublicId:       row.publicID,
			SeriesPublicId: row.seriesPublicID,
			Slug:           row.slug,
		}
		if row.lastModifiedAt.Valid {
			entry.LastModifiedAt = row.lastModifiedAt.Time.UTC().Format(time.RFC3339)
		}
		entries = append(entries, entry)
	}

	res := &publirav1.ListSitemapEntriesResponse{Entries: entries}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = pagination.EncodeCountUUID(pagination.Backward, int64(rows[0].kind), rows[0].id)
		}
		if hasNext {
			last := rows[len(rows)-1]
			res.NextToken = pagination.EncodeCountUUID(pagination.Forward, int64(last.kind), last.id)
		}
	// An empty page means the boundary entry was unpublished or deleted after
	// the token was issued. Recover once, the way the genre list does.
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		res.PreviousToken = pagination.EncodeCountUUIDRecovery(pagination.Backward, keys.Count, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		res.NextToken = pagination.EncodeCountUUIDRecovery(pagination.Forward, keys.Count, keys.ID)
	}

	return connect.NewResponse(res), nil
}
