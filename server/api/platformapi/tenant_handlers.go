package platformapi

import (
	"context"
	"database/sql"
	"errors"
	"net/mail"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publirasplatformv1 "github.com/publira/publira/server/gen/publira/platform/v1"
	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/dberr"
	"github.com/publira/publira/server/internal/pagination"
	"github.com/publira/publira/server/internal/publicid"
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

func tenantToProto(t dbmodels.Tenant) *publirasplatformv1.Tenant {
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
		Timezone:    tenanttz.Resolve(t.Timezone),
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

	// フィルタパラメータを処理
	filterName := strings.TrimSpace(req.Msg.Name)
	filterPublicID := strings.TrimSpace(req.Msg.PublicId)
	filterStatus := strings.TrimSpace(req.Msg.Status)

	tenants, err := s.tenantPage(ctx, filterName, filterPublicID, filterStatus, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	tenants, hasMore := pagination.Page(tenants, limit, cursor.Direction)

	resp := &publirasplatformv1.ListTenantsResponse{
		Tenants: make([]*publirasplatformv1.Tenant, len(tenants)),
	}
	for i, t := range tenants {
		resp.Tenants[i] = tenantToProto(t)
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
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&publirasplatformv1.GetTenantResponse{
		Tenant: tenantToProto(tenant),
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
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	defer tx.Rollback() //nolint:errcheck

	txq := dbmodels.New(tx)
	type pendingTenantAdminInvite struct {
		email string
		token string
	}
	pendingInvites := make([]pendingTenantAdminInvite, 0, len(initialAdminEmails))

	tenantID, err := uuid.NewV7()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	tenant, err := publicid.InsertTx(ctx, tx, func(publicID string) (dbmodels.Tenant, error) {
		return txq.CreateTenant(ctx, dbmodels.CreateTenantParams{
			ID:          tenantID,
			PublicID:    publicID,
			Domain:      domain,
			AdminDomain: adminDomain,
			Name:        name,
		})
	})
	if err != nil {
		if field := tenantUniqueViolationField(err); field != "" {
			return nil, connect.NewError(connect.CodeAlreadyExists, errors.New(field+" already exists"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	for _, email := range initialAdminEmails {
		user, err := txq.GetUserByEmailForTenant(ctx, dbmodels.GetUserByEmailForTenantParams{
			TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true},
			Email:    email,
		})
		if err != nil {
			if !errors.Is(err, sql.ErrNoRows) {
				return nil, connect.NewError(connect.CodeInternal, err)
			}

			token, tokenErr := generateInvitationToken()
			if tokenErr != nil {
				return nil, connect.NewError(connect.CodeInternal, tokenErr)
			}
			invitationID, invitationIDErr := uuid.NewV7()
			if invitationIDErr != nil {
				return nil, connect.NewError(connect.CodeInternal, invitationIDErr)
			}
			_, createInvitationErr := txq.CreateTenantAdminInvitation(ctx, dbmodels.CreateTenantAdminInvitationParams{
				ID:        invitationID,
				TenantID:  tenant.ID,
				Email:     email,
				TokenHash: auth.HashToken(token),
				ExpiresAt: time.Now().Add(tenantAdminInvitationTTL),
			})
			if createInvitationErr != nil {
				return nil, connect.NewError(connect.CodeInternal, createInvitationErr)
			}
			pendingInvites = append(pendingInvites, pendingTenantAdminInvite{email: email, token: token})
			continue
		}

		roles, err := txq.ListTenantUserRoles(ctx, user.ID)
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
		if len(roles) > 0 {
			continue
		}

		_, err = txq.CreateTenantUserRole(ctx, dbmodels.CreateTenantUserRoleParams{
			ID:     uuid.Must(uuid.NewV7()),
			UserID: user.ID,
			Role:   auth.RoleTenantAdmin,
		})
		if err != nil {
			if dberr.IsUniqueViolation(err) {
				continue
			}
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	for _, invite := range pendingInvites {
		if err := s.sendTenantAdminInvitationEmail(ctx, tenant, invite.email, invite.token); err != nil {
			return nil, err
		}
		if actor, ok := platformActorFromContext(ctx); ok {
			s.recorder.RecordPlatform(ctx, auditlog.PlatformEntry{
				ActorPlatformUserID: actor.UserID,
				ActorRole:           actor.Role,
				Action:              "tenant_admin_invited",
				TargetType:          "tenant_admin_invitation",
				TargetID:            invite.email,
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
		Tenant: tenantToProto(tenant),
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
		return nil, connect.NewError(connect.CodeInternal, err)
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
		Tenant: tenantToProto(tenant),
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
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("tenant not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
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
		Tenant: tenantToProto(tenant),
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
		return nil, connect.NewError(connect.CodeInternal, err)
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
		Tenant: tenantToProto(tenant),
	}), nil
}

func normalizeTenantMemberRole(rawRole string) (string, bool) {
	role := strings.TrimSpace(rawRole)
	switch role {
	case auth.RoleTenantAdmin:
		return auth.RoleTenantAdmin, true
	case auth.RoleTenantEditor:
		return auth.RoleTenantEditor, true
	case auth.RoleTenantAuditor:
		return auth.RoleTenantAuditor, true
	default:
		return "", false
	}
}

func tenantMemberToProto(row dbmodels.ListTenantUsersRow) *publirasplatformv1.TenantMember {
	return &publirasplatformv1.TenantMember{
		UserPublicId: row.PublicID,
		Name:         row.Name,
		Email:        row.Email,
		Role:         row.Role,
		Status:       row.Status,
		CreatedAt:    row.CreatedAt.UTC().Format("2006-01-02T15:04:05Z"),
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

	limit := req.Msg.Limit
	if limit <= 0 {
		limit = defaultListLimit
	}
	if limit > maxListLimit {
		limit = maxListLimit
	}
	offset := req.Msg.Offset
	if offset < 0 {
		offset = 0
	}

	tenant, err := s.queriesFor(ctx).GetTenantByPublicID(ctx, tenantPublicID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("tenant not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	rows, err := s.queriesFor(ctx).ListTenantUsers(ctx, dbmodels.ListTenantUsersParams{
		TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true},
		Limit:    limit,
		Offset:   offset,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	resp := &publirasplatformv1.ListTenantMembersResponse{
		Members: make([]*publirasplatformv1.TenantMember, len(rows)),
	}
	for i, row := range rows {
		resp.Members[i] = tenantMemberToProto(row)
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
	normalizedRole, ok := normalizeTenantMemberRole(req.Msg.Role)
	if !ok {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid role"))
	}

	tenant, err := s.queriesFor(ctx).GetTenantByPublicID(ctx, tenantPublicID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("tenant not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
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
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	roles, err := s.queriesFor(ctx).ListTenantUserRoles(ctx, user.ID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if len(roles) > 0 {
		return nil, connect.NewError(connect.CodeAlreadyExists, errors.New("user already has tenant roles"))
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	defer tx.Rollback() //nolint:errcheck

	txq := dbmodels.New(tx)

	_, err = txq.CreateTenantUserRole(ctx, dbmodels.CreateTenantUserRoleParams{
		ID:     uuid.Must(uuid.NewV7()),
		UserID: user.ID,
		Role:   normalizedRole,
	})
	if err != nil {
		if dberr.IsUniqueViolation(err) {
			return nil, connect.NewError(connect.CodeAlreadyExists, errors.New("user already has this role"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if err := tx.Commit(); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
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

func (s *platformServer) UpdateTenantMemberRole(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.UpdateTenantMemberRoleRequest],
) (*connect.Response[publirasplatformv1.UpdateTenantMemberRoleResponse], error) {
	tenantPublicID, err := resolveTenantPublicID(req.Msg.TenantPublicId, req.Header())
	if err != nil {
		return nil, err
	}
	userPublicID := strings.TrimSpace(req.Msg.UserPublicId)
	if userPublicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("user_public_id is required"))
	}
	normalizedRole, ok := normalizeTenantMemberRole(req.Msg.Role)
	if !ok {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid role"))
	}

	tenant, err := s.queriesFor(ctx).GetTenantByPublicID(ctx, tenantPublicID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("tenant not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	user, err := s.queriesFor(ctx).GetUserByPublicIDForTenant(ctx, dbmodels.GetUserByPublicIDForTenantParams{
		TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true},
		PublicID: userPublicID,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("member not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	roles, err := s.queriesFor(ctx).ListTenantUserRoles(ctx, user.ID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if len(roles) == 0 {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("member not found"))
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	defer tx.Rollback() //nolint:errcheck

	txq := dbmodels.New(tx)

	if err := txq.DeleteTenantUserRolesByUserID(ctx, user.ID); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	_, err = txq.CreateTenantUserRole(ctx, dbmodels.CreateTenantUserRoleParams{
		ID:     uuid.Must(uuid.NewV7()),
		UserID: user.ID,
		Role:   normalizedRole,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if err := tx.Commit(); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&publirasplatformv1.UpdateTenantMemberRoleResponse{
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

func (s *platformServer) RemoveTenantMember(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.RemoveTenantMemberRequest],
) (*connect.Response[publirasplatformv1.RemoveTenantMemberResponse], error) {
	tenantPublicID, err := resolveTenantPublicID(req.Msg.TenantPublicId, req.Header())
	if err != nil {
		return nil, err
	}
	userPublicID := strings.TrimSpace(req.Msg.UserPublicId)
	if userPublicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("user_public_id is required"))
	}

	tenant, err := s.queriesFor(ctx).GetTenantByPublicID(ctx, tenantPublicID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("tenant not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	user, err := s.queriesFor(ctx).GetUserByPublicIDForTenant(ctx, dbmodels.GetUserByPublicIDForTenantParams{
		TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true},
		PublicID: userPublicID,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("member not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if err := s.queriesFor(ctx).DeleteTenantUserRolesByUserID(ctx, user.ID); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&publirasplatformv1.RemoveTenantMemberResponse{
		UserPublicId: user.PublicID,
	}), nil
}
