package platformapi

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"strings"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/mailguard"
	"github.com/publira/publira/server/internal/pagination"
	"github.com/publira/publira/server/internal/platformconfig"
	"github.com/publira/publira/server/internal/platformtenants"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/tenantmembers"
	"github.com/publira/publira/server/internal/tenanttz"
)

const (
	defaultListLimit = 20
	maxListLimit     = 100
)

// tenantToProto renders a tenant row. platformDefaultTimezone yields the
// platform-wide default and is consulted only when the stored value is unusable.
func tenantToProto(t dbmodels.Tenant, platformDefaultTimezone func() string) *publirasplatformv1.Tenant {
	adminDomain := ""
	if t.AdminDomain.Valid {
		adminDomain = strings.TrimSpace(t.AdminDomain.String)
	}

	return &publirasplatformv1.Tenant{
		PublicId:    t.PublicID,
		Name:        t.Name,
		Status:      t.Status,
		CreatedAt:   t.CreatedAt.UTC().Format("2006-01-02T15:04:05Z"),
		Domain:      t.Domain,
		AdminDomain: adminDomain,
		Timezone:    tenanttz.Resolve(t.Timezone, platformDefaultTimezone),
	}
}

func (s *platformServer) ListTenants(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.ListTenantsRequest],
) (*connect.Response[publirasplatformv1.ListTenantsResponse], error) {
	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultListLimit, maxListLimit)
	cursor, err := pagination.Decode(req.Msg.Token)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	}
	filterName := strings.TrimSpace(req.Msg.Name)
	filterPublicID := strings.TrimSpace(req.Msg.PublicId)
	filterStatus := strings.TrimSpace(req.Msg.Status)
	listKey := pagination.NewListKey("created_at_desc").
		Value("name", filterName).
		Value("public_id", filterPublicID).
		Value("status", filterStatus)
	var keys pagination.TimeUUIDKeys
	if !cursor.IsZero() {
		keys, err = listKey.DecodeTimeUUID(cursor)
		if err != nil {
			return nil, rpcerrors.NewPageTokenError(err)
		}
	}

	tenants, err := s.tenantPage(ctx, filterName, filterPublicID, filterStatus, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list tenants", err)
	}
	tenants, hasMore := pagination.Page(tenants, limit, cursor.Direction)

	resp := &publirasplatformv1.ListTenantsResponse{
		Tenants: make([]*publirasplatformv1.Tenant, len(tenants)),
	}
	platformDefaultTimezone := platformconfig.DefaultTimeZoneFunc(ctx, s.queriesFor(ctx))
	for i, t := range tenants {
		resp.Tenants[i] = tenantToProto(t, platformDefaultTimezone)
	}
	switch {
	case len(tenants) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			resp.PreviousToken = listKey.EncodeTimeUUID(pagination.Backward, tenants[0].CreatedAt, tenants[0].ID)
		}
		if hasNext {
			last := tenants[len(tenants)-1]
			resp.NextToken = listKey.EncodeTimeUUID(pagination.Forward, last.CreatedAt, last.ID)
		}
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		resp.PreviousToken = listKey.EncodeTimeUUIDRecovery(pagination.Backward, keys.Time, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		resp.NextToken = listKey.EncodeTimeUUIDRecovery(pagination.Forward, keys.Time, keys.ID)
	}
	return connect.NewResponse(resp), nil
}

func (s *platformServer) tenantPage(
	ctx context.Context,
	filterName, filterPublicID, filterStatus string,
	keys pagination.TimeUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]dbmodels.Tenant, error) {
	queries := s.queriesFor(ctx)
	if direction == pagination.Backward {
		return queries.ListTenantsAsc(ctx, dbmodels.ListTenantsAscParams{
			FilterName:      sql.NullString{String: filterName, Valid: true},
			FilterPublicID:  sql.NullString{String: filterPublicID, Valid: true},
			FilterStatus:    sql.NullString{String: filterStatus, Valid: true},
			CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
			CursorInclusive: keys.Inclusive,
			CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
			Limit:           limit,
		})
	}

	return queries.ListTenantsDesc(ctx, dbmodels.ListTenantsDescParams{
		FilterName:      sql.NullString{String: filterName, Valid: true},
		FilterPublicID:  sql.NullString{String: filterPublicID, Valid: true},
		FilterStatus:    sql.NullString{String: filterStatus, Valid: true},
		CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
		CursorInclusive: keys.Inclusive,
		CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
		Limit:           limit,
	})
}

func (s *platformServer) GetTenant(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.GetTenantRequest],
) (*connect.Response[publirasplatformv1.GetTenantResponse], error) {
	tenant, err := platformtenants.Get(ctx, s.queriesFor(ctx), req.Msg.PublicId)
	if err != nil {
		return nil, s.tenantError(ctx, "failed to get tenant", err, "public_id", req.Msg.PublicId)
	}

	return connect.NewResponse(&publirasplatformv1.GetTenantResponse{
		Tenant: tenantToProto(tenant, platformconfig.DefaultTimeZoneFunc(ctx, s.queriesFor(ctx))),
	}), nil
}

func (s *platformServer) CreateTenant(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.CreateTenantRequest],
) (*connect.Response[publirasplatformv1.CreateTenantResponse], error) {
	creation, err := platformtenants.CreateParams{
		Name:               req.Msg.Name,
		Domain:             req.Msg.Domain,
		AdminDomain:        req.Msg.AdminDomain,
		DefaultLocale:      req.Msg.DefaultLocale,
		InitialAdminEmails: req.Msg.InitialAdminEmails,
	}.Validate()
	if err != nil {
		return nil, s.tenantError(ctx, "invalid create tenant request", err)
	}
	actor, err := s.auditActor(ctx, req)
	if err != nil {
		return nil, err
	}
	// A new tenant has no users yet, so every initial administrator is sent an
	// invitation, and each one is charged before the tenant is written.
	if err := s.mail.AllowEach(ctx, req, mailguard.PlatformScope, creation.InitialAdminEmails()); err != nil {
		return nil, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin create tenant transaction", err)
	}
	defer tx.Rollback() //nolint:errcheck

	created, err := platformtenants.Create(ctx, tx, s.logger, actor, creation)
	if err != nil {
		return nil, s.tenantError(ctx, "failed to create tenant", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit create tenant", err, "tenant_id", created.Tenant.ID.String())
	}

	return connect.NewResponse(&publirasplatformv1.CreateTenantResponse{
		Tenant: tenantToProto(created.Tenant, func() string { return created.Tenant.Timezone }),
	}), nil
}

// tenantError maps what platformtenants and tenantmembers refuse to this
// API's codes, naming the request field when the refusal has one. A Connect
// error, which is what the mail guard refuses with, passes through; anything
// else is a database failure.
func (s *platformServer) tenantError(ctx context.Context, msg string, err error, keyvals ...any) error {
	if fieldErr := rpcerrors.FromFieldError(err); fieldErr != nil {
		return fieldErr
	}
	var connectErr *connect.Error
	switch {
	case errors.As(err, &connectErr):
		return connectErr
	case errors.Is(err, platformtenants.ErrNoChange),
		errors.Is(err, tenantmembers.ErrUserOrEmailRequired),
		errors.Is(err, tenantmembers.ErrUserAndEmailBothSet):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, platformtenants.ErrNotFound),
		errors.Is(err, tenantmembers.ErrMemberNotFound),
		errors.Is(err, tenantmembers.ErrInvitationNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, tenantmembers.ErrAlreadyMember), errors.Is(err, tenantmembers.ErrRoleAlreadyHeld):
		return connect.NewError(connect.CodeAlreadyExists, err)
	case errors.Is(err, tenantmembers.ErrInvitationAccepted), errors.Is(err, tenantmembers.ErrInvitationWasCanceled):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	default:
		return s.internalDBError(ctx, msg, err, keyvals...)
	}
}

func (s *platformServer) SuspendTenant(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.SuspendTenantRequest],
) (*connect.Response[publirasplatformv1.SuspendTenantResponse], error) {
	tenant, err := s.setTenantStatus(ctx, req, req.Msg.PublicId, platformtenants.Suspend, "suspend tenant")
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&publirasplatformv1.SuspendTenantResponse{
		Tenant: tenantToProto(tenant, platformconfig.DefaultTimeZoneFunc(ctx, s.queriesFor(ctx))),
	}), nil
}

func (s *platformServer) ResumeTenant(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.ResumeTenantRequest],
) (*connect.Response[publirasplatformv1.ResumeTenantResponse], error) {
	tenant, err := s.setTenantStatus(ctx, req, req.Msg.PublicId, platformtenants.Resume, "resume tenant")
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&publirasplatformv1.ResumeTenantResponse{
		Tenant: tenantToProto(tenant, platformconfig.DefaultTimeZoneFunc(ctx, s.queriesFor(ctx))),
	}), nil
}

type tenantStatusChange func(context.Context, *sql.Tx, *slog.Logger, auditlog.PlatformActor, string) (dbmodels.Tenant, error)

func (s *platformServer) setTenantStatus(ctx context.Context, req connect.AnyRequest, rawPublicID string, change tenantStatusChange, what string) (dbmodels.Tenant, error) {
	publicID, err := platformtenants.ParsePublicID(rawPublicID)
	if err != nil {
		return dbmodels.Tenant{}, s.tenantError(ctx, "invalid "+what+" request", err)
	}
	actor, err := s.auditActor(ctx, req)
	if err != nil {
		return dbmodels.Tenant{}, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return dbmodels.Tenant{}, s.internalDBError(ctx, "failed to begin "+what+" transaction", err, "public_id", publicID)
	}
	defer tx.Rollback() //nolint:errcheck

	tenant, err := change(ctx, tx, s.logger, actor, publicID)
	if err != nil {
		return dbmodels.Tenant{}, s.tenantError(ctx, "failed to "+what, err, "public_id", publicID)
	}
	if err := tx.Commit(); err != nil {
		return dbmodels.Tenant{}, s.internalDBError(ctx, "failed to commit "+what, err, "public_id", publicID)
	}
	return tenant, nil
}

func (s *platformServer) UpdateTenant(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.UpdateTenantRequest],
) (*connect.Response[publirasplatformv1.UpdateTenantResponse], error) {
	// The request replaces all three, so an admin_domain left empty clears it.
	change, err := platformtenants.UpdateParams{
		PublicID:    req.Msg.PublicId,
		Name:        &req.Msg.Name,
		Domain:      &req.Msg.Domain,
		AdminDomain: &req.Msg.AdminDomain,
	}.Validate()
	if err != nil {
		return nil, s.tenantError(ctx, "invalid update tenant request", err)
	}
	actor, err := s.auditActor(ctx, req)
	if err != nil {
		return nil, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin update tenant transaction", err, "public_id", req.Msg.PublicId)
	}
	defer tx.Rollback() //nolint:errcheck

	tenant, err := platformtenants.Update(ctx, tx, s.logger, actor, change)
	if err != nil {
		return nil, s.tenantError(ctx, "failed to update tenant", err, "public_id", req.Msg.PublicId)
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit update tenant", err, "public_id", req.Msg.PublicId)
	}

	return connect.NewResponse(&publirasplatformv1.UpdateTenantResponse{
		Tenant: tenantToProto(tenant, platformconfig.DefaultTimeZoneFunc(ctx, s.queriesFor(ctx))),
	}), nil
}

func tenantMemberToProto(member tenantmembers.Member) *publirasplatformv1.TenantMember {
	return &publirasplatformv1.TenantMember{
		UserPublicId: member.PublicID,
		Name:         member.Name,
		Email:        member.Email,
		Role:         member.Role,
		Status:       member.Status,
		CreatedAt:    member.CreatedAt.UTC().Format("2006-01-02T15:04:05Z"),
	}
}

func (s *platformServer) ListTenantMembers(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.ListTenantMembersRequest],
) (*connect.Response[publirasplatformv1.ListTenantMembersResponse], error) {
	tenantPublicID, err := resolveTenantPublicID(req.Msg.TenantPublicId, req.Header())
	if err != nil {
		return nil, err
	}

	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultListLimit, maxListLimit)
	cursor, err := pagination.Decode(req.Msg.Token)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	}
	listKey := pagination.NewListKey("created_at_desc").Value("tenant_public_id", tenantPublicID)
	var keys pagination.TimeUUIDKeys
	if !cursor.IsZero() {
		keys, err = listKey.DecodeTimeUUID(cursor)
		if err != nil {
			return nil, rpcerrors.NewPageTokenError(err)
		}
	}

	tenant, err := s.tenantByPublicID(ctx, tenantPublicID)
	if err != nil {
		return nil, err
	}

	rows, err := tenantmembers.ListMembers(ctx, s.queriesFor(ctx), tenantmembers.ListParams{
		TenantID:  tenant.ID,
		Keys:      keys,
		Direction: cursor.Direction,
		Limit:     limit + 1,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list tenant members", err, "tenant_id", tenant.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	resp := &publirasplatformv1.ListTenantMembersResponse{
		Members: make([]*publirasplatformv1.TenantMember, len(rows)),
	}
	for i, row := range rows {
		resp.Members[i] = tenantMemberToProto(row)
	}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			resp.PreviousToken = listKey.EncodeTimeUUID(pagination.Backward, rows[0].CreatedAt, rows[0].UserID)
		}
		if hasNext {
			last := rows[len(rows)-1]
			resp.NextToken = listKey.EncodeTimeUUID(pagination.Forward, last.CreatedAt, last.UserID)
		}
	// An empty page means the boundary row was removed after the token was
	// issued. Hand back a token to where the client came from, so the only way
	// out is not to start over from the first page. A recovery token that comes
	// back empty means the boundary row is gone too: recover once, then leave
	// both tokens empty rather than bouncing the client between empty pages.
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		resp.PreviousToken = listKey.EncodeTimeUUIDRecovery(pagination.Backward, keys.Time, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		resp.NextToken = listKey.EncodeTimeUUIDRecovery(pagination.Forward, keys.Time, keys.ID)
	}
	return connect.NewResponse(resp), nil
}

func (s *platformServer) AddTenantMember(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.AddTenantMemberRequest],
) (*connect.Response[publirasplatformv1.AddTenantMemberResponse], error) {
	tenantPublicID, err := resolveTenantPublicID(req.Msg.TenantPublicId, req.Header())
	if err != nil {
		return nil, err
	}
	params := tenantmembers.AddParams{
		UserPublicID: req.Msg.UserPublicId,
		Email:        req.Msg.Email,
		Role:         req.Msg.Role,
	}
	if err := params.Validate(); err != nil {
		return nil, s.tenantError(ctx, "invalid add tenant member request", err)
	}

	tenant, err := s.tenantByPublicID(ctx, tenantPublicID)
	if err != nil {
		return nil, err
	}
	params.TenantID = tenant.ID

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin add tenant member transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	member, err := tenantmembers.Add(ctx, tx, params)
	if err != nil {
		return nil, s.tenantError(ctx, "failed to add tenant member", err, "tenant_id", tenant.ID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit add tenant member", err, "tenant_id", tenant.ID.String(), "user_id", member.UserID.String())
	}

	return connect.NewResponse(&publirasplatformv1.AddTenantMemberResponse{
		Member: tenantMemberToProto(member),
	}), nil
}

// UpdateTenantMemberRole and RemoveTenantMember do not keep a tenant_admin in
// place: the platform is how a tenant with none gets one back, and the operator
// has to be able to take the role from a compromised last administrator.
func (s *platformServer) UpdateTenantMemberRole(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.UpdateTenantMemberRoleRequest],
) (*connect.Response[publirasplatformv1.UpdateTenantMemberRoleResponse], error) {
	tenantPublicID, err := resolveTenantPublicID(req.Msg.TenantPublicId, req.Header())
	if err != nil {
		return nil, err
	}
	params := tenantmembers.UpdateRoleParams{
		UserPublicID: req.Msg.UserPublicId,
		Role:         req.Msg.Role,
	}
	if err := params.Validate(); err != nil {
		return nil, s.tenantError(ctx, "invalid update tenant member role request", err)
	}

	tenant, err := s.tenantByPublicID(ctx, tenantPublicID)
	if err != nil {
		return nil, err
	}
	params.TenantID = tenant.ID

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin update tenant member role transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	member, err := tenantmembers.UpdateRole(ctx, tx, params)
	if err != nil {
		return nil, s.tenantError(ctx, "failed to update tenant member role", err, "tenant_id", tenant.ID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit update tenant member role", err, "tenant_id", tenant.ID.String(), "user_id", member.UserID.String())
	}

	return connect.NewResponse(&publirasplatformv1.UpdateTenantMemberRoleResponse{
		Member: tenantMemberToProto(member),
	}), nil
}

func (s *platformServer) RemoveTenantMember(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.RemoveTenantMemberRequest],
) (*connect.Response[publirasplatformv1.RemoveTenantMemberResponse], error) {
	tenantPublicID, err := resolveTenantPublicID(req.Msg.TenantPublicId, req.Header())
	if err != nil {
		return nil, err
	}
	params := tenantmembers.RemoveParams{UserPublicID: req.Msg.UserPublicId}
	if err := params.Validate(); err != nil {
		return nil, s.tenantError(ctx, "invalid remove tenant member request", err)
	}

	tenant, err := s.tenantByPublicID(ctx, tenantPublicID)
	if err != nil {
		return nil, err
	}
	params.TenantID = tenant.ID

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin remove tenant member transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	member, err := tenantmembers.Remove(ctx, tx, params)
	if err != nil {
		return nil, s.tenantError(ctx, "failed to remove tenant member", err, "tenant_id", tenant.ID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit remove tenant member", err, "tenant_id", tenant.ID.String(), "user_id", member.UserID.String())
	}

	return connect.NewResponse(&publirasplatformv1.RemoveTenantMemberResponse{
		UserPublicId: member.PublicID,
	}), nil
}
