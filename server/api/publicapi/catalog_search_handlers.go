package publicapi

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/catalogsearch"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
)

const maxSearchQueryRunes = 100

// normalizeSearchQuery trims the keyword and rejects empty / oversized input
// before it reaches a backend. 100 runes is enough for a storefront search box
// and keeps the token (which carries the query) from growing without bound.
func normalizeSearchQuery(raw string) (string, error) {
	query := strings.TrimSpace(raw)
	if query == "" {
		return "", connect.NewError(connect.CodeInvalidArgument, errors.New("query is required"))
	}
	if utf8.RuneCountInString(query) > maxSearchQueryRunes {
		return "", connect.NewError(connect.CodeInvalidArgument, errors.New("query is too long"))
	}
	return query, nil
}

// searchRequest is what the three searches share: the tenant, and the page the
// backend is asked for.
type searchRequest struct {
	tenant  dbmodels.Tenant
	backend catalogsearch.Request
}

func (s *apiServer) searchRequest(
	ctx context.Context,
	tenantCtx *publirattypesv1.TenantContext,
	requestedSurface publirattypesv1.ClientSurface,
	rawQuery string,
	requestedLimit int32,
	token string,
	defaultLimit int32,
	maxLimit int32,
) (searchRequest, error) {
	tenant, err := s.tenantByContext(ctx, tenantCtx)
	if err != nil {
		return searchRequest{}, err
	}
	surface, err := callingSurface(requestedSurface)
	if err != nil {
		return searchRequest{}, err
	}
	query, err := normalizeSearchQuery(rawQuery)
	if err != nil {
		return searchRequest{}, err
	}
	cursor, err := decodeSurfaceToken(token, surface)
	if err != nil {
		return searchRequest{}, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	}
	return searchRequest{
		tenant: tenant,
		backend: catalogsearch.Request{
			TenantID: tenant.ID,
			Surface:  surface,
			Query:    query,
			Limit:    pagination.NormalizeLimit(requestedLimit, defaultLimit, maxLimit),
			Cursor:   cursor,
		},
	}, nil
}

// searchError answers a backend failure. A token the backend refuses is the
// caller's mistake and is named without its internals; anything else is ours.
func (s *apiServer) searchError(ctx context.Context, msg string, err error, tenantID uuid.UUID) error {
	switch {
	case errors.Is(err, catalogsearch.ErrTokenForAnotherQuery):
		return connect.NewError(connect.CodeInvalidArgument, errors.New("token was issued for another query"))
	case errors.Is(err, catalogsearch.ErrInvalidToken):
		return connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	default:
		return s.internalDBError(ctx, msg, err, "tenant_id", tenantID.String())
	}
}

func (s *apiServer) SearchPublishedSeries(
	ctx context.Context,
	req *connect.Request[publirav1.SearchPublishedSeriesRequest],
) (*connect.Response[publirav1.SearchPublishedSeriesResponse], error) {
	search, err := s.searchRequest(ctx, req.Msg.Tenant, req.Msg.Surface, req.Msg.Query, req.Msg.Limit, req.Msg.Token, defaultSeriesPageSize, maxSeriesPageSize)
	if err != nil {
		return nil, err
	}
	page, err := s.search.SearchSeries(ctx, search.backend)
	if err != nil {
		return nil, s.searchError(ctx, "failed to search published series", err, search.tenant.ID)
	}
	rows, err := s.activeSeriesRowsInOrder(ctx, search.tenant.ID, search.backend.Surface, page.IDs)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to search published series", err, "tenant_id", search.tenant.ID.String())
	}
	items, err := s.publishedSeriesItems(ctx, rows)
	if err != nil {
		return nil, err
	}

	res := &publirav1.SearchPublishedSeriesResponse{Series: items, PreviousToken: page.PreviousToken, NextToken: page.NextToken}
	bindSurfaceTokens(search.backend.Surface, &res.PreviousToken, &res.NextToken)
	return connect.NewResponse(res), nil
}

func (s *apiServer) SearchPublishedCreators(
	ctx context.Context,
	req *connect.Request[publirav1.SearchPublishedCreatorsRequest],
) (*connect.Response[publirav1.SearchPublishedCreatorsResponse], error) {
	search, err := s.searchRequest(ctx, req.Msg.Tenant, req.Msg.Surface, req.Msg.Query, req.Msg.Limit, req.Msg.Token, defaultCreatorPageSize, maxCreatorPageSize)
	if err != nil {
		return nil, err
	}
	page, err := s.search.SearchCreators(ctx, search.backend)
	if err != nil {
		return nil, s.searchError(ctx, "failed to search published creators", err, search.tenant.ID)
	}
	rows, err := s.publishedCreatorRowsInOrder(ctx, search.tenant.ID, search.backend.Surface, page.IDs)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to search published creators", err, "tenant_id", search.tenant.ID.String())
	}

	items := make([]*publirav1.PublishedCreator, 0, len(rows))
	for _, row := range rows {
		items = append(items, publishedCreatorFromListRow(row))
	}

	res := &publirav1.SearchPublishedCreatorsResponse{Creators: items, PreviousToken: page.PreviousToken, NextToken: page.NextToken}
	bindSurfaceTokens(search.backend.Surface, &res.PreviousToken, &res.NextToken)
	return connect.NewResponse(res), nil
}

// publishedLabelDisplaysInOrder reads the labels a search found, in the order
// it found them.
func (s *apiServer) publishedLabelDisplaysInOrder(
	ctx context.Context,
	tenantID uuid.UUID,
	surface string,
	ids []uuid.UUID,
) ([]labelDisplay, error) {
	if len(ids) == 0 {
		return nil, nil
	}

	rows, err := s.queriesFor(ctx).ListPublishedLabelsByIDs(ctx, dbmodels.ListPublishedLabelsByIDsParams{
		TenantID: tenantID,
		Surface:  surface,
		Ids:      ids,
	})
	if err != nil {
		return nil, err
	}

	byID := make(map[uuid.UUID]dbmodels.ListPublishedLabelsByIDsRow, len(rows))
	for _, row := range rows {
		byID[row.ID] = row
	}

	ordered := make([]labelDisplay, 0, len(ids))
	for _, id := range ids {
		// A label whose last published series went away between the two reads
		// drops out, the same way an unpublished series does.
		row, ok := byID[id]
		if !ok {
			continue
		}
		ordered = append(ordered, labelDisplay{
			publicID:               row.PublicID,
			name:                   row.Name,
			eyeCatchImageID:        row.EyeCatchImageID,
			eyeCatchImageUpdatedAt: row.EyeCatchImageUpdatedAt,
		})
	}
	return ordered, nil
}

func (s *apiServer) SearchPublishedLabels(
	ctx context.Context,
	req *connect.Request[publirav1.SearchPublishedLabelsRequest],
) (*connect.Response[publirav1.SearchPublishedLabelsResponse], error) {
	search, err := s.searchRequest(ctx, req.Msg.Tenant, req.Msg.Surface, req.Msg.Query, req.Msg.Limit, req.Msg.Token, defaultLabelPageSize, maxLabelPageSize)
	if err != nil {
		return nil, err
	}
	page, err := s.search.SearchLabels(ctx, search.backend)
	if err != nil {
		return nil, s.searchError(ctx, "failed to search published labels", err, search.tenant.ID)
	}
	displays, err := s.publishedLabelDisplaysInOrder(ctx, search.tenant.ID, search.backend.Surface, page.IDs)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to search published labels", err, "tenant_id", search.tenant.ID.String())
	}
	items, err := s.labelItems(ctx, displays)
	if err != nil {
		return nil, err
	}

	res := &publirav1.SearchPublishedLabelsResponse{Labels: items, PreviousToken: page.PreviousToken, NextToken: page.NextToken}
	bindSurfaceTokens(search.backend.Surface, &res.PreviousToken, &res.NextToken)
	return connect.NewResponse(res), nil
}
