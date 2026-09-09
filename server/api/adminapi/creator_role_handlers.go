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
	defaultCreatorRolePageSize = int32(20)
	maxCreatorRolePageSize     = int32(100)

	// maxCreatorRoleNameRunes bounds a role name. It counts code points rather
	// than bytes, so a name costs the same length in every script. The bound is
	// what a credit line and a select can show; a role described at greater
	// length is a job description.
	maxCreatorRoleNameRunes = 50
)

// normalizeCreatorRoleName trims a role name and checks it against the bound.
// Unlike a genre it derives no slug: a role is never addressed by name, so the
// name is compared case-insensitively by the database instead.
func normalizeCreatorRoleName(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	if name == "" {
		return "", rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("name is required"), "name")
	}
	if utf8.RuneCountInString(name) > maxCreatorRoleNameRunes {
		return "", rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, fmt.Errorf("name must be at most %d characters", maxCreatorRoleNameRunes), "name")
	}
	return name, nil
}

func creatorRoleRevalidateTags(tenantID string) []string {
	normalizedTenantID := strings.TrimSpace(tenantID)
	return []string{
		fmt.Sprintf("tenant:%s:creator_roles", normalizedTenantID),
		fmt.Sprintf("tenant:%s:series:list", normalizedTenantID),
		fmt.Sprintf("tenant:%s:series:detail", normalizedTenantID),
	}
}

// recordCreatorRoleChange files the audit entry for one role write. A role
// orders and names the credits on every series, so all of the writes are
// recorded, not only the destructive one.
func (s *adminServer) recordCreatorRoleChange(ctx context.Context, tenantID uuid.UUID, header http.Header, action, targetID string) {
	sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx)
	if !ok {
		return
	}
	s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    tenantID,
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		Action:      action,
		TargetType:  "creator_role",
		TargetID:    targetID,
		Outcome:     auditlog.OutcomeSuccess,
		ClientIP:    auditlog.ClientIPFromHeader(header),
	})
}

func (s *adminServer) revalidateCreatorRoles(ctx context.Context, tenant dbmodels.Tenant, action string) {
	if s.reval == nil {
		return
	}
	if err := s.reval.RevalidateTags(ctx, creatorRoleRevalidateTags(tenant.ID.String())); err != nil {
		s.logger.Warn("failed to request next revalidate after creator role change", "tenant_public_id", tenant.PublicID, "action", action, "error", err)
	}
}

// creatorRolePageRow is one row of a role page, shared by the ascending and
// descending keyset queries so the handler reads a single shape.
type creatorRolePageRow struct {
	id              uuid.UUID
	publicID        string
	name            string
	displayPriority int32
}

func mapCreatorRoleAscRows(rows []dbmodels.ListCreatorRolesByTenantAscRow) []creatorRolePageRow {
	mapped := make([]creatorRolePageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, creatorRolePageRow{
			id:              row.ID,
			publicID:        row.PublicID,
			name:            row.Name,
			displayPriority: row.DisplayPriority,
		})
	}
	return mapped
}

func mapCreatorRoleDescRows(rows []dbmodels.ListCreatorRolesByTenantDescRow) []creatorRolePageRow {
	mapped := make([]creatorRolePageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, creatorRolePageRow{
			id:              row.ID,
			publicID:        row.PublicID,
			name:            row.Name,
			displayPriority: row.DisplayPriority,
		})
	}
	return mapped
}

// creatorRolePage runs the keyset query for one page. The list reads in the
// tenant's own priority order, so a backward page is scanned by the descending
// query and put back into that order by pagination.Page.
func (s *adminServer) creatorRolePage(
	ctx context.Context,
	tenantID uuid.UUID,
	keys pagination.CountUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]creatorRolePageRow, error) {
	queries := s.queriesFor(ctx)
	if direction == pagination.Backward {
		rows, err := queries.ListCreatorRolesByTenantDesc(ctx, dbmodels.ListCreatorRolesByTenantDescParams{
			TenantID:              tenantID,
			CursorID:              uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
			CursorInclusive:       keys.Inclusive,
			CursorDisplayPriority: sql.NullInt32{Int32: int32(keys.Count), Valid: keys.Valid},
			Limit:                 limit,
		})
		if err != nil {
			return nil, err
		}
		return mapCreatorRoleDescRows(rows), nil
	}

	rows, err := queries.ListCreatorRolesByTenantAsc(ctx, dbmodels.ListCreatorRolesByTenantAscParams{
		TenantID:              tenantID,
		CursorID:              uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
		CursorInclusive:       keys.Inclusive,
		CursorDisplayPriority: sql.NullInt32{Int32: int32(keys.Count), Valid: keys.Valid},
		Limit:                 limit,
	})
	if err != nil {
		return nil, err
	}
	return mapCreatorRoleAscRows(rows), nil
}

func (s *adminServer) ListCreatorRoles(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ListCreatorRolesRequest],
) (*connect.Response[publiraadminv1.ListCreatorRolesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultCreatorRolePageSize, maxCreatorRolePageSize)
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
	rows, err := s.creatorRolePage(ctx, tenant.ID, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list creator roles", err, "tenant_id", tenant.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	creatorRoles := make([]*publirattypesv1.CreatorRole, 0, len(rows))
	for _, row := range rows {
		creatorRoles = append(creatorRoles, &publirattypesv1.CreatorRole{
			PublicId: row.publicID,
			Name:     row.name,
		})
	}

	res := &publiraadminv1.ListCreatorRolesResponse{CreatorRoles: creatorRoles}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = pagination.EncodeCountUUID(pagination.Backward, int64(rows[0].displayPriority), rows[0].id)
		}
		if hasNext {
			last := rows[len(rows)-1]
			res.NextToken = pagination.EncodeCountUUID(pagination.Forward, int64(last.displayPriority), last.id)
		}
	// An empty page means the boundary role was deleted, or moved by a
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

func (s *adminServer) CreateCreatorRole(
	ctx context.Context,
	req *connect.Request[publiraadminv1.CreateCreatorRoleRequest],
) (*connect.Response[publiraadminv1.CreateCreatorRoleResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	name, err := normalizeCreatorRoleName(req.Msg.Name)
	if err != nil {
		return nil, err
	}
	creatorRoleID, err := uuid.NewV7()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	maxDisplayPriority, err := s.queriesFor(ctx).GetMaxCreatorRoleDisplayPriorityForTenant(ctx, tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to resolve the next creator role display priority", err, "tenant_id", tenant.ID.String())
	}
	created, err := publicid.Insert(func(publicID string) (dbmodels.CreatorRole, error) {
		return s.queriesFor(ctx).CreateCreatorRole(ctx, dbmodels.CreateCreatorRoleParams{
			ID:              creatorRoleID,
			TenantID:        tenant.ID,
			PublicID:        publicID,
			Name:            name,
			DisplayPriority: maxDisplayPriority + 1,
		})
	})
	if err != nil {
		if dberr.IsUniqueViolation(err) {
			return nil, existingCreatorRoleNameError()
		}
		return nil, s.internalDBError(ctx, "failed to create creator role", err, "tenant_id", tenant.ID.String())
	}

	s.recordCreatorRoleChange(ctx, tenant.ID, req.Header(), "creator_role_created", created.PublicID)
	s.revalidateCreatorRoles(ctx, tenant, "create")

	return connect.NewResponse(&publiraadminv1.CreateCreatorRoleResponse{
		CreatorRole: &publirattypesv1.CreatorRole{PublicId: created.PublicID, Name: created.Name},
	}), nil
}

// existingCreatorRoleNameError reports a name another role of the tenant
// already holds. The two names may differ on screen — "Original Author"
// against "original author" — so the message says what collided rather than
// repeating the name back.
func existingCreatorRoleNameError() error {
	return rpcerrors.NewFieldViolationError(
		connect.CodeAlreadyExists,
		errors.New("a creator role with this name already exists"),
		"name",
	)
}

func (s *adminServer) UpdateCreatorRole(
	ctx context.Context,
	req *connect.Request[publiraadminv1.UpdateCreatorRoleRequest],
) (*connect.Response[publiraadminv1.UpdateCreatorRoleResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	name, err := normalizeCreatorRoleName(req.Msg.Name)
	if err != nil {
		return nil, err
	}
	current, err := s.creatorRoleByPublicID(ctx, tenant.ID, req.Msg.PublicId)
	if err != nil {
		return nil, err
	}
	if err := s.queriesFor(ctx).UpdateCreatorRole(ctx, dbmodels.UpdateCreatorRoleParams{
		ID:   current.ID,
		Name: name,
	}); err != nil {
		if dberr.IsUniqueViolation(err) {
			return nil, existingCreatorRoleNameError()
		}
		return nil, s.internalDBError(ctx, "failed to update creator role", err, "tenant_id", tenant.ID.String(), "creator_role_id", current.ID.String())
	}

	s.recordCreatorRoleChange(ctx, tenant.ID, req.Header(), "creator_role_updated", current.PublicID)
	s.revalidateCreatorRoles(ctx, tenant, "update")

	return connect.NewResponse(&publiraadminv1.UpdateCreatorRoleResponse{
		CreatorRole: &publirattypesv1.CreatorRole{PublicId: current.PublicID, Name: name},
	}), nil
}

func (s *adminServer) ReorderCreatorRoles(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ReorderCreatorRolesRequest],
) (*connect.Response[publiraadminv1.ReorderCreatorRolesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if err := validateReorderPublicIDs(req.Msg.CreatorRolePublicIds, "creator_role_public_ids", "creator role"); err != nil {
		return nil, err
	}
	if err := validateReorderPublicIDs(req.Msg.ExpectedCreatorRolePublicIds, "expected_creator_role_public_ids", "creator role"); err != nil {
		return nil, err
	}
	if !samePublicIDSet(req.Msg.CreatorRolePublicIds, req.Msg.ExpectedCreatorRolePublicIds) {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("creator_role_public_ids must be a permutation of expected_creator_role_public_ids"))
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin reorder creator roles transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	txCtx := rpcmiddleware.WithTenantQueries(ctx, dbmodels.New(tx))
	// Locking every role of the tenant is what makes the comparison below mean
	// something: no concurrent write can add, remove, or move one between the
	// check and the write.
	locked, err := s.queriesFor(txCtx).LockCreatorRolesForTenant(txCtx, tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to lock creator roles for reorder", err, "tenant_id", tenant.ID.String())
	}
	byPublicID := make(map[string]dbmodels.LockCreatorRolesForTenantRow, len(locked))
	currentOrder := make([]string, 0, len(locked))
	for _, row := range locked {
		byPublicID[row.PublicID] = row
		currentOrder = append(currentOrder, row.PublicID)
	}
	if !slices.Equal(currentOrder, req.Msg.ExpectedCreatorRolePublicIds) {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("creator role order has changed"))
	}

	creatorRoles := make([]*publirattypesv1.CreatorRole, 0, len(req.Msg.CreatorRolePublicIds))
	for index, publicID := range req.Msg.CreatorRolePublicIds {
		row := byPublicID[publicID]
		if err := s.queriesFor(txCtx).UpdateCreatorRoleDisplayPriority(txCtx, dbmodels.UpdateCreatorRoleDisplayPriorityParams{
			ID:              row.ID,
			DisplayPriority: int32(index + 1),
		}); err != nil {
			return nil, s.internalDBError(ctx, "failed to update creator role display priority", err, "tenant_id", tenant.ID.String(), "creator_role_id", row.ID.String())
		}
		creatorRoles = append(creatorRoles, &publirattypesv1.CreatorRole{PublicId: row.PublicID, Name: row.Name})
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit reorder creator roles", err, "tenant_id", tenant.ID.String())
	}

	s.recordCreatorRoleChange(ctx, tenant.ID, req.Header(), "creator_roles_reordered", tenant.PublicID)
	s.revalidateCreatorRoles(ctx, tenant, "reorder")

	return connect.NewResponse(&publiraadminv1.ReorderCreatorRolesResponse{CreatorRoles: creatorRoles}), nil
}

func (s *adminServer) DeleteCreatorRole(
	ctx context.Context,
	req *connect.Request[publiraadminv1.DeleteCreatorRoleRequest],
) (*connect.Response[publiraadminv1.DeleteCreatorRoleResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	current, err := s.creatorRoleByPublicID(ctx, tenant.ID, req.Msg.PublicId)
	if err != nil {
		return nil, err
	}
	credited, err := s.queriesFor(ctx).CountSeriesCreatorsByRoleIDForTenant(ctx, dbmodels.CountSeriesCreatorsByRoleIDForTenantParams{
		TenantID: tenant.ID,
		RoleID:   current.ID,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to count credits of a creator role", err, "tenant_id", tenant.ID.String(), "creator_role_id", current.ID.String())
	}
	if credited > 0 {
		return nil, creatorRoleInUseError(credited)
	}
	if err := s.queriesFor(ctx).DeleteCreatorRole(ctx, current.ID); err != nil {
		// A series can take the role between the count and the delete. The
		// foreign key is what actually holds the line, so its refusal is
		// reported as the same failed precondition rather than as a fault.
		if dberr.IsForeignKeyViolation(err) {
			return nil, creatorRoleInUseError(1)
		}
		return nil, s.internalDBError(ctx, "failed to delete creator role", err, "tenant_id", tenant.ID.String(), "creator_role_id", current.ID.String())
	}

	s.recordCreatorRoleChange(ctx, tenant.ID, req.Header(), "creator_role_deleted", current.PublicID)
	s.revalidateCreatorRoles(ctx, tenant, "delete")

	return connect.NewResponse(&publiraadminv1.DeleteCreatorRoleResponse{}), nil
}

// creatorRoleInUseError refuses to delete a role a credit still names.
// Deleting it would take those credits with it, so the count is part of the
// message: it tells the editor how much work re-crediting them is.
func creatorRoleInUseError(credited int32) error {
	return connect.NewError(
		connect.CodeFailedPrecondition,
		fmt.Errorf("creator role is used by %d credits and cannot be deleted", credited),
	)
}

func (s *adminServer) creatorRoleByPublicID(ctx context.Context, tenantID uuid.UUID, publicID string) (dbmodels.GetCreatorRoleByPublicIDForTenantRow, error) {
	row, err := s.queriesFor(ctx).GetCreatorRoleByPublicIDForTenant(ctx, dbmodels.GetCreatorRoleByPublicIDForTenantParams{
		TenantID: tenantID,
		PublicID: strings.TrimSpace(publicID),
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dbmodels.GetCreatorRoleByPublicIDForTenantRow{}, connect.NewError(connect.CodeNotFound, errors.New("creator role not found"))
		}
		return dbmodels.GetCreatorRoleByPublicIDForTenantRow{}, s.internalDBError(ctx, "failed to get creator role", err, "tenant_id", tenantID.String(), "creator_role_public_id", publicID)
	}
	return row, nil
}
