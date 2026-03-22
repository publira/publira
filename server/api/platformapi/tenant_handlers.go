package platformapi

import (
	"context"
	"database/sql"
	"errors"
	"net/mail"
	"strings"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	publirasplatformv1 "github.com/publira/publira/server/gen/publira/platform/v1"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db"
)

const (
	tenantStatusActive    = "active"
	tenantStatusSuspended = "suspended"

	defaultListLimit = 20
	maxListLimit     = 100
	tenantAdminRole  = auth.RoleTenantAdmin
)

func tenantUniqueViolationField(err error) string {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23505" {
		return ""
	}

	switch pgErr.ConstraintName {
	case "tenants_public_id_key":
		return "public_id"
	case "tenants_domain_key":
		return "domain"
	default:
		return ""
	}
}

func tenantToProto(t dbmodels.Tenant) *publirasplatformv1.Tenant {
	return &publirasplatformv1.Tenant{
		PublicId:  t.PublicID,
		Name:      t.Name,
		Status:    t.Status,
		CreatedAt: t.CreatedAt.UTC().Format("2006-01-02T15:04:05Z"),
		Domain:    t.Domain,
	}
}

func (s *platformServer) ListTenants(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.ListTenantsRequest],
) (*connect.Response[publirasplatformv1.ListTenantsResponse], error) {
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

	// フィルタパラメータを処理
	filterName := strings.TrimSpace(req.Msg.Name)
	filterPublicID := strings.TrimSpace(req.Msg.PublicId)
	filterStatus := strings.TrimSpace(req.Msg.Status)

	tenants, err := s.queries.ListTenants(ctx, dbmodels.ListTenantsParams{
		Limit:          limit,
		Offset:         offset,
		FilterName:     sql.NullString{String: filterName, Valid: true},
		FilterPublicID: sql.NullString{String: filterPublicID, Valid: true},
		FilterStatus:   sql.NullString{String: filterStatus, Valid: true},
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	resp := &publirasplatformv1.ListTenantsResponse{
		Tenants: make([]*publirasplatformv1.Tenant, len(tenants)),
	}
	for i, t := range tenants {
		resp.Tenants[i] = tenantToProto(t)
	}
	return connect.NewResponse(resp), nil
}

func (s *platformServer) GetTenant(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.GetTenantRequest],
) (*connect.Response[publirasplatformv1.GetTenantResponse], error) {
	publicID := strings.TrimSpace(req.Msg.PublicId)
	if publicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("public_id is required"))
	}

	tenant, err := s.queries.GetTenantByPublicID(ctx, publicID)
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
	adminEmails := make([]string, 0, len(req.Msg.InitialAdminEmails))
	seenEmails := make(map[string]struct{}, len(req.Msg.InitialAdminEmails))
	for _, rawEmail := range req.Msg.InitialAdminEmails {
		email := strings.TrimSpace(strings.ToLower(rawEmail))
		if email == "" {
			continue
		}
		if _, err := mail.ParseAddress(email); err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid initial_admin_emails"))
		}
		if _, exists := seenEmails[email]; exists {
			continue
		}
		seenEmails[email] = struct{}{}
		adminEmails = append(adminEmails, email)
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	defer tx.Rollback() //nolint:errcheck

	txq := dbmodels.New(tx)

	tenantID, err := uuid.NewV7()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	tenant, err := txq.CreateTenant(ctx, dbmodels.CreateTenantParams{
		ID:       tenantID,
		PublicID: generatePublicID(),
		Domain:   domain,
		Name:     name,
	})
	if err != nil {
		if field := tenantUniqueViolationField(err); field != "" {
			return nil, connect.NewError(connect.CodeAlreadyExists, errors.New(field+" already exists"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	for _, adminEmail := range adminEmails {
		user, err := txq.GetUserByEmail(ctx, adminEmail)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				continue
			}
			return nil, connect.NewError(connect.CodeInternal, err)
		}

		membershipID, err := uuid.NewV7()
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
		membership, err := txq.CreateTenantMembership(ctx, dbmodels.CreateTenantMembershipParams{
			ID:       membershipID,
			UserID:   user.ID,
			TenantID: tenant.ID,
			Status:   defaultMembershipStatus,
		})
		if err != nil {
			if isUniqueViolation(err) {
				continue
			}
			return nil, connect.NewError(connect.CodeInternal, err)
		}

		_, err = txq.CreateTenantMemberRole(ctx, dbmodels.CreateTenantMemberRoleParams{
			ID:           uuid.Must(uuid.NewV7()),
			MembershipID: membership.ID,
			Role:         tenantAdminRole,
		})
		if err != nil {
			if isUniqueViolation(err) {
				continue
			}
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
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

	tenant, err := s.queries.UpdateTenantStatus(ctx, dbmodels.UpdateTenantStatusParams{
		PublicID: publicID,
		Status:   tenantStatusSuspended,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("tenant not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
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

	tenant, err := s.queries.UpdateTenantInfo(ctx, dbmodels.UpdateTenantInfoParams{
		PublicID: publicID,
		Name:     name,
		Domain:   domain,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("tenant not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
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

	tenant, err := s.queries.UpdateTenantStatus(ctx, dbmodels.UpdateTenantStatusParams{
		PublicID: publicID,
		Status:   tenantStatusActive,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("tenant not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&publirasplatformv1.ResumeTenantResponse{
		Tenant: tenantToProto(tenant),
	}), nil
}

func normalizeTenantMemberRole(rawRole string) (string, bool) {
	role := strings.TrimSpace(rawRole)
	switch role {
	case auth.RoleTenantAdmin, auth.RoleLegacyAdmin:
		return auth.RoleTenantAdmin, true
	case auth.RoleTenantEditor, auth.RoleLegacyEditor:
		return auth.RoleTenantEditor, true
	case auth.RoleTenantAuditor, auth.RoleLegacyAuditor:
		return auth.RoleTenantAuditor, true
	default:
		return "", false
	}
}

func tenantMemberToProto(row dbmodels.ListTenantMembershipsRow) *publirasplatformv1.TenantMember {
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
	tenantPublicID := strings.TrimSpace(req.Msg.TenantPublicId)
	if tenantPublicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("tenant_public_id is required"))
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

	tenant, err := s.queries.GetTenantByPublicID(ctx, tenantPublicID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("tenant not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	rows, err := s.queries.ListTenantMemberships(ctx, dbmodels.ListTenantMembershipsParams{
		TenantID: tenant.ID,
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
	tenantPublicID := strings.TrimSpace(req.Msg.TenantPublicId)
	if tenantPublicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("tenant_public_id is required"))
	}
	userPublicID := strings.TrimSpace(req.Msg.UserPublicId)
	if userPublicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("user_public_id is required"))
	}
	normalizedRole, ok := normalizeTenantMemberRole(req.Msg.Role)
	if !ok {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid role"))
	}

	tenant, err := s.queries.GetTenantByPublicID(ctx, tenantPublicID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("tenant not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	user, err := s.queries.GetUserByPublicID(ctx, userPublicID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("user not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	_, err = s.queries.GetTenantMembershipByUserAndTenant(ctx, dbmodels.GetTenantMembershipByUserAndTenantParams{
		UserID:   user.ID,
		TenantID: tenant.ID,
	})
	if err == nil {
		return nil, connect.NewError(connect.CodeAlreadyExists, errors.New("user is already a member of this tenant"))
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	defer tx.Rollback() //nolint:errcheck

	txq := dbmodels.New(tx)

	membershipID, err := uuid.NewV7()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	membership, err := txq.CreateTenantMembership(ctx, dbmodels.CreateTenantMembershipParams{
		ID:       membershipID,
		UserID:   user.ID,
		TenantID: tenant.ID,
		Status:   defaultMembershipStatus,
	})
	if err != nil {
		if isUniqueViolation(err) {
			return nil, connect.NewError(connect.CodeAlreadyExists, errors.New("user is already a member of this tenant"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	_, err = txq.CreateTenantMemberRole(ctx, dbmodels.CreateTenantMemberRoleParams{
		ID:           uuid.Must(uuid.NewV7()),
		MembershipID: membership.ID,
		Role:         normalizedRole,
	})
	if err != nil {
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
			Status:       membership.Status,
			CreatedAt:    membership.CreatedAt.UTC().Format("2006-01-02T15:04:05Z"),
		},
	}), nil
}

func (s *platformServer) UpdateTenantMemberRole(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.UpdateTenantMemberRoleRequest],
) (*connect.Response[publirasplatformv1.UpdateTenantMemberRoleResponse], error) {
	tenantPublicID := strings.TrimSpace(req.Msg.TenantPublicId)
	if tenantPublicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("tenant_public_id is required"))
	}
	userPublicID := strings.TrimSpace(req.Msg.UserPublicId)
	if userPublicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("user_public_id is required"))
	}
	normalizedRole, ok := normalizeTenantMemberRole(req.Msg.Role)
	if !ok {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid role"))
	}

	tenant, err := s.queries.GetTenantByPublicID(ctx, tenantPublicID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("tenant not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	user, err := s.queries.GetUserByPublicID(ctx, userPublicID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("user not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	membership, err := s.queries.GetTenantMembershipByUserAndTenant(ctx, dbmodels.GetTenantMembershipByUserAndTenantParams{
		UserID:   user.ID,
		TenantID: tenant.ID,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("member not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	defer tx.Rollback() //nolint:errcheck

	txq := dbmodels.New(tx)

	if err := txq.DeleteTenantMemberRolesByMembershipID(ctx, membership.ID); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	_, err = txq.CreateTenantMemberRole(ctx, dbmodels.CreateTenantMemberRoleParams{
		ID:           uuid.Must(uuid.NewV7()),
		MembershipID: membership.ID,
		Role:         normalizedRole,
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
			Status:       membership.Status,
			CreatedAt:    membership.CreatedAt.UTC().Format("2006-01-02T15:04:05Z"),
		},
	}), nil
}

func (s *platformServer) RemoveTenantMember(
	ctx context.Context,
	req *connect.Request[publirasplatformv1.RemoveTenantMemberRequest],
) (*connect.Response[publirasplatformv1.RemoveTenantMemberResponse], error) {
	tenantPublicID := strings.TrimSpace(req.Msg.TenantPublicId)
	if tenantPublicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("tenant_public_id is required"))
	}
	userPublicID := strings.TrimSpace(req.Msg.UserPublicId)
	if userPublicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("user_public_id is required"))
	}

	tenant, err := s.queries.GetTenantByPublicID(ctx, tenantPublicID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("tenant not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	user, err := s.queries.GetUserByPublicID(ctx, userPublicID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("user not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	membership, err := s.queries.GetTenantMembershipByUserAndTenant(ctx, dbmodels.GetTenantMembershipByUserAndTenantParams{
		UserID:   user.ID,
		TenantID: tenant.ID,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("member not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if err := s.queries.DeleteTenantMembership(ctx, membership.ID); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&publirasplatformv1.RemoveTenantMemberResponse{
		UserPublicId: user.PublicID,
	}), nil
}
