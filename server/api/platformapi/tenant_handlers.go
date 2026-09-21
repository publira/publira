package platformapi

import (
	"context"
	"database/sql"
	"errors"
	"net/mail"
	"strings"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/creatorroles"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/dberr"
	"github.com/publira/publira/server/internal/locale"
	"github.com/publira/publira/server/internal/pagination"
	"github.com/publira/publira/server/internal/platformconfig"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	"github.com/publira/publira/server/internal/publicid"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/tenantmembers"
	"github.com/publira/publira/server/internal/tenanttz"
)

const (
	tenantStatusActive    = "active"
	tenantStatusSuspended = "suspended"

	defaultListLimit = 20
	maxListLimit     = 100
)

func tenantUniqueViolationField(err error) string {
	switch dberr.UniqueViolationConstraint(err) {
	case "tenants_public_id_key":
		return "public_id"
	case "tenants_domain_key":
		return "domain"
	case "tenants_admin_domain_key":
		return "admin_domain"
	default:
		return ""
	}
}

func nullableTrimmedString(v string) sql.NullString {
	trimmed := strings.TrimSpace(v)
	if trimmed == "" {
		return sql.NullString{}
	}

	return sql.NullString{String: trimmed, Valid: true}
}

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
	var keys pagination.TimeUUIDKeys
	if !cursor.IsZero() {
		keys, err = pagination.DecodeTimeUUID(cursor)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
		}
	}

	// Build the filter parameters.
	filterName := strings.TrimSpace(req.Msg.Name)
	filterPublicID := strings.TrimSpace(req.Msg.PublicId)
	filterStatus := strings.TrimSpace(req.Msg.Status)

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
			resp.PreviousToken = pagination.EncodeTimeUUID(pagination.Backward, tenants[0].CreatedAt, tenants[0].ID)
		}
		if hasNext {
			last := tenants[len(tenants)-1]
			resp.NextToken = pagination.EncodeTimeUUID(pagination.Forward, last.CreatedAt, last.ID)
		}
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		resp.PreviousToken = pagination.EncodeTimeUUIDRecovery(pagination.Backward, keys.Time, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		resp.NextToken = pagination.EncodeTimeUUIDRecovery(pagination.Forward, keys.Time, keys.ID)
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
	publicID := strings.TrimSpace(req.Msg.PublicId)
	if publicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("public_id is required"))
	}

	tenant, err := s.queriesFor(ctx).GetTenantByPublicID(ctx, publicID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("tenant not found"))
		}
		return nil, s.internalDBError(ctx, "failed to get tenant", err, "public_id", publicID)
	}

	return connect.NewResponse(&publirasplatformv1.GetTenantResponse{
		Tenant: tenantToProto(tenant, platformconfig.DefaultTimeZoneFunc(ctx, s.queriesFor(ctx))),
	}), nil
}

func (s *platformServer) CreateTenant(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.CreateTenantRequest],
) (*connect.Response[publirasplatformv1.CreateTenantResponse], error) {
	name := strings.TrimSpace(req.Msg.Name)
	if name == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("name is required"))
	}
	domain := strings.TrimSpace(req.Msg.Domain)
	if domain == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("domain is required"))
	}
	defaultLocale, err := locale.Normalize(req.Msg.DefaultLocale)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	adminDomain := nullableTrimmedString(req.Msg.AdminDomain)
	initialAdminEmails := make([]string, 0, len(req.Msg.InitialAdminEmails))
	seenInitialAdminEmail := make(map[string]struct{}, len(req.Msg.InitialAdminEmails))
	for _, rawEmail := range req.Msg.InitialAdminEmails {
		email := strings.TrimSpace(strings.ToLower(rawEmail))
		if email == "" {
			continue
		}
		if _, err := mail.ParseAddress(email); err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid initial_admin_emails"))
		}
		if _, exists := seenInitialAdminEmail[email]; exists {
			continue
		}
		seenInitialAdminEmail[email] = struct{}{}
		initialAdminEmails = append(initialAdminEmails, email)
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin create tenant transaction", err)
	}
	defer tx.Rollback() //nolint:errcheck

	txq := dbmodels.New(tx)
	pendingInvitationEmails := make([]string, 0, len(initialAdminEmails))

	tenantID, err := uuid.NewV7()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// The time zone is applied explicitly instead of relying on the column
	// default, so an install that changed it starts every new tenant on it.
	// The locale comes from the request: the server never picks a language.
	defaultTimezone := platformconfig.DefaultTimeZone(ctx, txq)

	tenant, err := publicid.InsertTx(ctx, tx, func(publicID string) (dbmodels.Tenant, error) {
		return txq.CreateTenant(ctx, dbmodels.CreateTenantParams{
			ID:            tenantID,
			PublicID:      publicID,
			Domain:        domain,
			AdminDomain:   adminDomain,
			Name:          name,
			Timezone:      defaultTimezone,
			DefaultLocale: defaultLocale,
		})
	})
	if err != nil {
		if field := tenantUniqueViolationField(err); field != "" {
			return nil, rpcerrors.NewFieldViolationError(connect.CodeAlreadyExists, errors.New(field+" already exists"), field)
		}
		return nil, s.internalDBError(ctx, "failed to create tenant", err)
	}

	if err := creatorroles.CreateDefaults(ctx, tx, tenant.ID); err != nil {
		return nil, s.internalDBError(ctx, "failed to create default creator roles", err, "tenant_id", tenant.ID.String())
	}

	for _, email := range initialAdminEmails {
		user, err := txq.GetUserByEmailForTenant(ctx, dbmodels.GetUserByEmailForTenantParams{
			TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true},
			Email:    email,
		})
		if err != nil {
			if !errors.Is(err, sql.ErrNoRows) {
				return nil, s.internalDBError(ctx, "failed to get user by email for tenant", err, "tenant_id", tenant.ID.String())
			}

			invitation, err := tenantmembers.IssueInvitation(ctx, txq, tenant.ID, email)
			if err != nil {
				return nil, s.internalDBError(ctx, "failed to invite tenant admin", err, "tenant_id", tenant.ID.String())
			}
			pendingInvitationEmails = append(pendingInvitationEmails, invitation.Email)
			continue
		}

		roles, err := txq.ListTenantUserRoles(ctx, user.ID)
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to list tenant user roles", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
		}
		if len(roles) > 0 {
			continue
		}

		_, err = txq.CreateTenantUserRole(ctx, dbmodels.CreateTenantUserRoleParams{
			ID:       uuid.Must(uuid.NewV7()),
			TenantID: tenant.ID,
			UserID:   user.ID,
			Role:     auth.RoleTenantAdmin,
		})
		if err != nil {
			if dberr.IsUniqueViolation(err) {
				continue
			}
			return nil, s.internalDBError(ctx, "failed to create tenant user role", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit create tenant", err, "tenant_id", tenant.ID.String())
	}

	for _, email := range pendingInvitationEmails {
		if actor, ok := platformActorFromContext(ctx); ok {
			s.recorder.RecordPlatform(ctx, auditlog.PlatformEntry{
				ActorPlatformUserID: actor.UserID,
				ActorRole:           actor.Role,
				Action:              "tenant_admin_invited",
				TargetType:          "tenant_admin_invitation",
				TargetID:            email,
				Outcome:             auditlog.OutcomeSuccess,
				ClientIP:            auditlog.ClientIPFromHeader(req.Header()),
			})
		}
	}

	// Record audit log
	if actor, ok := platformActorFromContext(ctx); ok {
		s.recorder.RecordPlatform(ctx, auditlog.PlatformEntry{
			ActorPlatformUserID: actor.UserID,
			ActorRole:           actor.Role,
			Action:              "tenant_created",
			TargetType:          "tenant",
			TargetID:            tenant.ID.String(),
			Outcome:             auditlog.OutcomeSuccess,
			ClientIP:            auditlog.ClientIPFromHeader(req.Header()),
		})
	}

	return connect.NewResponse(&publirasplatformv1.CreateTenantResponse{
		Tenant: tenantToProto(tenant, func() string { return defaultTimezone }),
	}), nil
}

func (s *platformServer) SuspendTenant(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.SuspendTenantRequest],
) (*connect.Response[publirasplatformv1.SuspendTenantResponse], error) {
	publicID := strings.TrimSpace(req.Msg.PublicId)
	if publicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("public_id is required"))
	}

	tenant, err := s.queriesFor(ctx).UpdateTenantStatus(ctx, dbmodels.UpdateTenantStatusParams{
		PublicID: publicID,
		Status:   tenantStatusSuspended,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("tenant not found"))
		}
		return nil, s.internalDBError(ctx, "failed to suspend tenant", err, "public_id", publicID)
	}
	if actor, ok := platformActorFromContext(ctx); ok {
		s.recorder.RecordPlatform(ctx, auditlog.PlatformEntry{
			ActorPlatformUserID: actor.UserID,
			ActorRole:           actor.Role,
			Action:              "tenant_suspended",
			TargetType:          "tenant",
			TargetID:            tenant.ID.String(),
			Outcome:             auditlog.OutcomeSuccess,
			ClientIP:            auditlog.ClientIPFromHeader(req.Header()),
		})
	}

	return connect.NewResponse(&publirasplatformv1.SuspendTenantResponse{
		Tenant: tenantToProto(tenant, platformconfig.DefaultTimeZoneFunc(ctx, s.queriesFor(ctx))),
	}), nil
}

func (s *platformServer) UpdateTenant(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.UpdateTenantRequest],
) (*connect.Response[publirasplatformv1.UpdateTenantResponse], error) {
	publicID := strings.TrimSpace(req.Msg.PublicId)
	if publicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("public_id is required"))
	}
	name := strings.TrimSpace(req.Msg.Name)
	if name == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("name is required"))
	}
	domain := strings.TrimSpace(req.Msg.Domain)
	if domain == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("domain is required"))
	}
	adminDomain := nullableTrimmedString(req.Msg.AdminDomain)

	tenant, err := s.queriesFor(ctx).UpdateTenantInfo(ctx, dbmodels.UpdateTenantInfoParams{
		PublicID:    publicID,
		Name:        name,
		Domain:      domain,
		AdminDomain: adminDomain,
	})
	if err != nil {
		if field := tenantUniqueViolationField(err); field != "" {
			return nil, rpcerrors.NewFieldViolationError(connect.CodeAlreadyExists, errors.New(field+" already exists"), field)
		}
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("tenant not found"))
		}
		return nil, s.internalDBError(ctx, "failed to update tenant", err, "public_id", publicID)
	}
	if actor, ok := platformActorFromContext(ctx); ok {
		s.recorder.RecordPlatform(ctx, auditlog.PlatformEntry{
			ActorPlatformUserID: actor.UserID,
			ActorRole:           actor.Role,
			Action:              "tenant_info_updated",
			TargetType:          "tenant",
			TargetID:            tenant.ID.String(),
			Outcome:             auditlog.OutcomeSuccess,
			ClientIP:            auditlog.ClientIPFromHeader(req.Header()),
		})
	}

	return connect.NewResponse(&publirasplatformv1.UpdateTenantResponse{
		Tenant: tenantToProto(tenant, platformconfig.DefaultTimeZoneFunc(ctx, s.queriesFor(ctx))),
	}), nil
}

func (s *platformServer) ResumeTenant(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.ResumeTenantRequest],
) (*connect.Response[publirasplatformv1.ResumeTenantResponse], error) {
	publicID := strings.TrimSpace(req.Msg.PublicId)
	if publicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("public_id is required"))
	}

	tenant, err := s.queriesFor(ctx).UpdateTenantStatus(ctx, dbmodels.UpdateTenantStatusParams{
		PublicID: publicID,
		Status:   tenantStatusActive,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("tenant not found"))
		}
		return nil, s.internalDBError(ctx, "failed to resume tenant", err, "public_id", publicID)
	}
	if actor, ok := platformActorFromContext(ctx); ok {
		s.recorder.RecordPlatform(ctx, auditlog.PlatformEntry{
			ActorPlatformUserID: actor.UserID,
			ActorRole:           actor.Role,
			Action:              "tenant_resumed",
			TargetType:          "tenant",
			TargetID:            tenant.ID.String(),
			Outcome:             auditlog.OutcomeSuccess,
			ClientIP:            auditlog.ClientIPFromHeader(req.Header()),
		})
	}

	return connect.NewResponse(&publirasplatformv1.ResumeTenantResponse{
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

// tenantMemberError maps what tenantmembers refuses to this API's codes;
// anything else is a database failure.
func (s *platformServer) tenantMemberError(ctx context.Context, msg string, err error, keyvals ...any) error {
	switch {
	case errors.Is(err, tenantmembers.ErrUserPublicIDRequired), errors.Is(err, tenantmembers.ErrInvalidRole):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, tenantmembers.ErrMemberNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	default:
		return s.internalDBError(ctx, msg, err, keyvals...)
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
	var keys pagination.TimeUUIDKeys
	if !cursor.IsZero() {
		keys, err = pagination.DecodeTimeUUID(cursor)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
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
			resp.PreviousToken = pagination.EncodeTimeUUID(pagination.Backward, rows[0].CreatedAt, rows[0].UserID)
		}
		if hasNext {
			last := rows[len(rows)-1]
			resp.NextToken = pagination.EncodeTimeUUID(pagination.Forward, last.CreatedAt, last.UserID)
		}
	// An empty page means the boundary row was removed after the token was
	// issued. Hand back a token to where the client came from, so the only way
	// out is not to start over from the first page. A recovery token that comes
	// back empty means the boundary row is gone too: recover once, then leave
	// both tokens empty rather than bouncing the client between empty pages.
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		resp.PreviousToken = pagination.EncodeTimeUUIDRecovery(pagination.Backward, keys.Time, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		resp.NextToken = pagination.EncodeTimeUUIDRecovery(pagination.Forward, keys.Time, keys.ID)
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
	userPublicID := strings.TrimSpace(req.Msg.UserPublicId)
	email := strings.TrimSpace(strings.ToLower(req.Msg.Email))
	if userPublicID == "" && email == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("user_public_id or email is required"))
	}
	if userPublicID != "" && email != "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("user_public_id and email cannot both be set"))
	}
	if email != "" {
		if _, err := mail.ParseAddress(email); err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid email"))
		}
	}
	normalizedRole, ok := tenantmembers.NormalizeRole(req.Msg.Role)
	if !ok {
		return nil, connect.NewError(connect.CodeInvalidArgument, tenantmembers.ErrInvalidRole)
	}

	tenant, err := s.tenantByPublicID(ctx, tenantPublicID)
	if err != nil {
		return nil, err
	}

	var user dbmodels.GetUserByPublicIDForTenantRow
	if userPublicID != "" {
		user, err = s.queriesFor(ctx).GetUserByPublicIDForTenant(ctx, dbmodels.GetUserByPublicIDForTenantParams{
			TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true},
			PublicID: userPublicID,
		})
	} else {
		userByEmail, lookupErr := s.queriesFor(ctx).GetUserByEmailForTenant(ctx, dbmodels.GetUserByEmailForTenantParams{
			TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true},
			Email:    email,
		})
		if lookupErr == nil {
			user = dbmodels.GetUserByPublicIDForTenantRow{
				CreatedAt: userByEmail.CreatedAt,
				Email:     userByEmail.Email,
				ID:        userByEmail.ID,
				Name:      userByEmail.Name,
				PublicID:  userByEmail.PublicID,
				Status:    userByEmail.Status,
			}
		}
		err = lookupErr
	}
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("member not found"))
		}
		return nil, s.internalDBError(ctx, "failed to get tenant member", err, "tenant_id", tenant.ID.String())
	}

	roles, err := s.queriesFor(ctx).ListTenantUserRoles(ctx, user.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list tenant user roles", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	if len(roles) > 0 {
		return nil, connect.NewError(connect.CodeAlreadyExists, errors.New("user already has tenant roles"))
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin add tenant member transaction", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	txq := dbmodels.New(tx)

	_, err = txq.CreateTenantUserRole(ctx, dbmodels.CreateTenantUserRoleParams{
		ID:       uuid.Must(uuid.NewV7()),
		TenantID: tenant.ID,
		UserID:   user.ID,
		Role:     normalizedRole,
	})
	if err != nil {
		if dberr.IsUniqueViolation(err) {
			return nil, connect.NewError(connect.CodeAlreadyExists, errors.New("user already has this role"))
		}
		return nil, s.internalDBError(ctx, "failed to create tenant user role", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}

	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit add tenant member", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}

	return connect.NewResponse(&publirasplatformv1.AddTenantMemberResponse{
		Member: &publirasplatformv1.TenantMember{
			UserPublicId: user.PublicID,
			Name:         user.Name,
			Email:        user.Email,
			Role:         normalizedRole,
			Status:       user.Status,
			CreatedAt:    user.CreatedAt.UTC().Format("2006-01-02T15:04:05Z"),
		},
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
	if strings.TrimSpace(req.Msg.UserPublicId) == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, tenantmembers.ErrUserPublicIDRequired)
	}
	if _, ok := tenantmembers.NormalizeRole(req.Msg.Role); !ok {
		return nil, connect.NewError(connect.CodeInvalidArgument, tenantmembers.ErrInvalidRole)
	}

	tenant, err := s.tenantByPublicID(ctx, tenantPublicID)
	if err != nil {
		return nil, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin update tenant member role transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	member, err := tenantmembers.UpdateRole(ctx, tx, tenantmembers.UpdateRoleParams{
		TenantID:     tenant.ID,
		UserPublicID: req.Msg.UserPublicId,
		Role:         req.Msg.Role,
	})
	if err != nil {
		return nil, s.tenantMemberError(ctx, "failed to update tenant member role", err, "tenant_id", tenant.ID.String())
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
	if strings.TrimSpace(req.Msg.UserPublicId) == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, tenantmembers.ErrUserPublicIDRequired)
	}

	tenant, err := s.tenantByPublicID(ctx, tenantPublicID)
	if err != nil {
		return nil, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin remove tenant member transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	member, err := tenantmembers.Remove(ctx, tx, tenantmembers.RemoveParams{
		TenantID:     tenant.ID,
		UserPublicID: req.Msg.UserPublicId,
	})
	if err != nil {
		return nil, s.tenantMemberError(ctx, "failed to remove tenant member", err, "tenant_id", tenant.ID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit remove tenant member", err, "tenant_id", tenant.ID.String(), "user_id", member.UserID.String())
	}

	return connect.NewResponse(&publirasplatformv1.RemoveTenantMemberResponse{
		UserPublicId: member.PublicID,
	}), nil
}
