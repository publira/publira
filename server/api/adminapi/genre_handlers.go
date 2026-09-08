package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"unicode/utf8"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/catalogslug"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/dberr"
	"github.com/publira/publira/server/internal/pagination"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/publicid"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
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

func (s *adminServer) revalidateGenres(ctx context.Context, tenant dbmodels.Tenant, action string) {
	if s.reval == nil {
		return
	}
	if err := s.reval.RevalidateTags(ctx, genreRevalidateTags(tenant.ID.String())); err != nil {
		s.logger.Warn("failed to request next revalidate after genre change", "tenant_public_id", tenant.PublicID, "action", action, "error", err)
	}
}

// genrePageRow is one row of a genre page, shared by the ascending and
// descending keyset queries so the handler reads a single shape.
type genrePageRow struct {
	id           uuid.UUID
	publicID     string
	name         string
	slug         string
	displayOrder int32
}

func mapGenreAscRows(rows []dbmodels.ListGenresByTenantAscRow) []genrePageRow {
	mapped := make([]genrePageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, genrePageRow{
			id:           row.ID,
			publicID:     row.PublicID,
			name:         row.Name,
			slug:         row.Slug,
			displayOrder: row.DisplayOrder,
		})
	}
	return mapped
}

func mapGenreDescRows(rows []dbmodels.ListGenresByTenantDescRow) []genrePageRow {
	mapped := make([]genrePageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, genrePageRow{
			id:           row.ID,
			publicID:     row.PublicID,
			name:         row.Name,
			slug:         row.Slug,
			displayOrder: row.DisplayOrder,
		})
	}
	return mapped
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
	}

	// One row past the page: its presence is what says another page exists.
	rows, err := s.genrePage(ctx, tenant.ID, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list genres", err, "tenant_id", tenant.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	genres := make([]*publirattypesv1.Genre, 0, len(rows))
	for _, row := range rows {
		genres = append(genres, &publirattypesv1.Genre{
			PublicId: row.publicID,
			Name:     row.name,
			Slug:     row.slug,
		})
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
	genreID, err := uuid.NewV7()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	maxDisplayOrder, err := s.queriesFor(ctx).GetMaxGenreDisplayOrderForTenant(ctx, tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to resolve the next genre display order", err, "tenant_id", tenant.ID.String())
	}
	created, err := publicid.Insert(func(publicID string) (dbmodels.Genre, error) {
		return s.queriesFor(ctx).CreateGenre(ctx, dbmodels.CreateGenreParams{
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

	s.recordGenreChange(ctx, tenant.ID, req.Header(), "genre_created", created.PublicID)
	s.revalidateGenres(ctx, tenant, "create")

	return connect.NewResponse(&publiraadminv1.CreateGenreResponse{
		Genre: &publirattypesv1.Genre{PublicId: created.PublicID, Name: created.Name, Slug: created.Slug},
	}), nil
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
	current, err := s.genreByPublicID(ctx, tenant.ID, req.Msg.PublicId)
	if err != nil {
		return nil, err
	}
	if err := s.queriesFor(ctx).UpdateGenre(ctx, dbmodels.UpdateGenreParams{
		ID:   current.ID,
		Name: normalized.name,
		Slug: normalized.slug,
	}); err != nil {
		if dberr.IsUniqueViolation(err) {
			return nil, existingGenreNameError()
		}
		return nil, s.internalDBError(ctx, "failed to update genre", err, "tenant_id", tenant.ID.String(), "genre_id", current.ID.String())
	}

	s.recordGenreChange(ctx, tenant.ID, req.Header(), "genre_updated", current.PublicID)
	s.revalidateGenres(ctx, tenant, "update")

	return connect.NewResponse(&publiraadminv1.UpdateGenreResponse{
		Genre: &publirattypesv1.Genre{PublicId: current.PublicID, Name: normalized.name, Slug: normalized.slug},
	}), nil
}

func (s *adminServer) ReorderGenres(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ReorderGenresRequest],
) (*connect.Response[publiraadminv1.ReorderGenresResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if err := validateReorderPublicIDs(req.Msg.GenrePublicIds, "genre_public_ids", "genre"); err != nil {
		return nil, err
	}
	if err := validateReorderPublicIDs(req.Msg.ExpectedGenrePublicIds, "expected_genre_public_ids", "genre"); err != nil {
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

	genres := make([]*publirattypesv1.Genre, 0, len(req.Msg.GenrePublicIds))
	for index, publicID := range req.Msg.GenrePublicIds {
		row := byPublicID[publicID]
		if err := s.queriesFor(txCtx).UpdateGenreDisplayOrder(txCtx, dbmodels.UpdateGenreDisplayOrderParams{
			ID:           row.ID,
			DisplayOrder: int32(index + 1),
		}); err != nil {
			return nil, s.internalDBError(ctx, "failed to update genre display order", err, "tenant_id", tenant.ID.String(), "genre_id", row.ID.String())
		}
		genres = append(genres, &publirattypesv1.Genre{PublicId: row.PublicID, Name: row.Name, Slug: row.Slug})
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit reorder genres", err, "tenant_id", tenant.ID.String())
	}

	s.recordGenreChange(ctx, tenant.ID, req.Header(), "genres_reordered", tenant.PublicID)
	s.revalidateGenres(ctx, tenant, "reorder")

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
	s.revalidateGenres(ctx, tenant, "delete")

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
