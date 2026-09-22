// Package tenantmembers holds what a tenant's console members and its
// administrator invitations are, for every surface that manages them: the
// Platform Console on any tenant, and a tenant administrator on their own.
// Nothing here speaks Connect; each adapter maps the errors below to its own
// codes.
package tenantmembers

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	"github.com/publira/publira/server/internal/tenantlock"
)

var (
	ErrUserPublicIDRequired = errors.New("user_public_id is required")
	ErrInvalidRole          = errors.New("invalid role")
	ErrMemberNotFound       = errors.New("member not found")
	// ErrLastAdmin refuses a change that would leave the tenant with no active
	// tenant_admin, and so with nobody who can sign in to manage it.
	ErrLastAdmin = errors.New("the tenant's last active tenant_admin cannot be removed or demoted")
)

// NormalizeRole answers the console role raw names, or false for anything
// that is not one.
func NormalizeRole(raw string) (string, bool) {
	switch role := strings.TrimSpace(raw); role {
	case auth.RoleTenantAdmin, auth.RoleTenantEditor, auth.RoleTenantAuditor:
		return role, true
	default:
		return "", false
	}
}

// Member is a user holding a console role in a tenant, under the highest role
// they hold.
type Member struct {
	UserID    uuid.UUID
	PublicID  string
	Name      string
	Email     string
	Role      string
	Status    string
	CreatedAt time.Time
}

// ListParams is one page of a tenant's members or invitations, in
// (created_at, id) order. Cursor rules: proto/README.md.
type ListParams struct {
	TenantID  uuid.UUID
	Keys      pagination.TimeUUIDKeys
	Direction pagination.Direction
	Limit     int32
}

// ListMembers reads one page of the tenant's members. A backward page comes
// back in ascending order, for [pagination.Page] to flip.
func ListMembers(ctx context.Context, q dbmodels.Querier, p ListParams) ([]Member, error) {
	tenantID := uuid.NullUUID{UUID: p.TenantID, Valid: true}
	cursorID := uuid.NullUUID{UUID: p.Keys.ID, Valid: p.Keys.Valid}
	cursorCreatedAt := sql.NullTime{Time: p.Keys.Time, Valid: p.Keys.Valid}

	if p.Direction == pagination.Backward {
		rows, err := q.ListTenantMembersAsc(ctx, dbmodels.ListTenantMembersAscParams{
			TenantID:        tenantID,
			CursorID:        cursorID,
			CursorInclusive: p.Keys.Inclusive,
			CursorCreatedAt: cursorCreatedAt,
			Limit:           p.Limit,
		})
		if err != nil {
			return nil, err
		}
		members := make([]Member, len(rows))
		for i, row := range rows {
			members[i] = Member{UserID: row.UserID, PublicID: row.PublicID, Name: row.Name, Email: row.Email, Role: row.Role, Status: row.Status, CreatedAt: row.CreatedAt}
		}
		return members, nil
	}

	rows, err := q.ListTenantMembersDesc(ctx, dbmodels.ListTenantMembersDescParams{
		TenantID:        tenantID,
		CursorID:        cursorID,
		CursorInclusive: p.Keys.Inclusive,
		CursorCreatedAt: cursorCreatedAt,
		Limit:           p.Limit,
	})
	if err != nil {
		return nil, err
	}
	members := make([]Member, len(rows))
	for i, row := range rows {
		members[i] = Member{UserID: row.UserID, PublicID: row.PublicID, Name: row.Name, Email: row.Email, Role: row.Role, Status: row.Status, CreatedAt: row.CreatedAt}
	}
	return members, nil
}

// UpdateRoleParams replaces a member's console role with Role.
type UpdateRoleParams struct {
	TenantID     uuid.UUID
	UserPublicID string
	Role         string
	// KeepAnAdmin refuses the change with [ErrLastAdmin] when it would demote
	// the tenant's last active tenant_admin.
	KeepAnAdmin bool
}

// UpdateRole replaces the member's roles with the one p names, inside tx.
func UpdateRole(ctx context.Context, tx *sql.Tx, p UpdateRoleParams) (Member, error) {
	role, ok := NormalizeRole(p.Role)
	if !ok {
		return Member{}, ErrInvalidRole
	}
	member, err := findMember(ctx, tx, p.TenantID, p.UserPublicID, p.KeepAnAdmin)
	if err != nil {
		return Member{}, err
	}
	if p.KeepAnAdmin && role != auth.RoleTenantAdmin {
		if err := refuseLastAdmin(ctx, tx, p.TenantID, member); err != nil {
			return Member{}, err
		}
	}

	if err := replaceRole(ctx, dbmodels.New(tx), p.TenantID, member.UserID, role); err != nil {
		return Member{}, err
	}
	member.Role = role
	return member, nil
}

// RemoveParams takes every console role away from a member, who stays a user
// of the tenant.
type RemoveParams struct {
	TenantID     uuid.UUID
	UserPublicID string
	// KeepAnAdmin refuses the removal with [ErrLastAdmin] when it would remove
	// the tenant's last active tenant_admin.
	KeepAnAdmin bool
}

// Remove deletes the member's roles inside tx.
func Remove(ctx context.Context, tx *sql.Tx, p RemoveParams) (Member, error) {
	member, err := findMember(ctx, tx, p.TenantID, p.UserPublicID, p.KeepAnAdmin)
	if err != nil {
		return Member{}, err
	}
	if p.KeepAnAdmin {
		if err := refuseLastAdmin(ctx, tx, p.TenantID, member); err != nil {
			return Member{}, err
		}
	}

	if err := dbmodels.New(tx).DeleteTenantUserRolesByUserID(ctx, member.UserID); err != nil {
		return Member{}, fmt.Errorf("delete tenant user roles: %w", err)
	}
	return member, nil
}

// findMember resolves the user and the role they hold now. With lock, it first
// takes the tenant's administrator lock, so two administrators demoting each
// other at once cannot both see the other one left.
func findMember(ctx context.Context, tx *sql.Tx, tenantID uuid.UUID, rawPublicID string, lock bool) (Member, error) {
	publicID := strings.TrimSpace(rawPublicID)
	if publicID == "" {
		return Member{}, ErrUserPublicIDRequired
	}
	if lock {
		if err := tenantlock.Take(ctx, tx, "tenant-admins:"+tenantID.String()); err != nil {
			return Member{}, err
		}
	}

	q := dbmodels.New(tx)
	user, err := q.GetUserByPublicIDForTenant(ctx, dbmodels.GetUserByPublicIDForTenantParams{
		TenantID: uuid.NullUUID{UUID: tenantID, Valid: true},
		PublicID: publicID,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Member{}, ErrMemberNotFound
		}
		return Member{}, fmt.Errorf("get tenant member: %w", err)
	}
	roles, err := q.ListTenantUserRoles(ctx, user.ID)
	if err != nil {
		return Member{}, fmt.Errorf("list tenant user roles: %w", err)
	}
	if len(roles) == 0 {
		return Member{}, ErrMemberNotFound
	}

	return Member{
		UserID:    user.ID,
		PublicID:  user.PublicID,
		Name:      user.Name,
		Email:     user.Email,
		Role:      auth.ResolveTenantRole(roles),
		Status:    user.Status,
		CreatedAt: user.CreatedAt,
	}, nil
}

func refuseLastAdmin(ctx context.Context, tx *sql.Tx, tenantID uuid.UUID, member Member) error {
	if member.Role != auth.RoleTenantAdmin {
		return nil
	}
	others, err := dbmodels.New(tx).CountOtherActiveTenantAdmins(ctx, dbmodels.CountOtherActiveTenantAdminsParams{
		TenantID: tenantID,
		UserID:   member.UserID,
	})
	if err != nil {
		return fmt.Errorf("count other active tenant admins: %w", err)
	}
	if others == 0 {
		return ErrLastAdmin
	}
	return nil
}

func replaceRole(ctx context.Context, q *dbmodels.Queries, tenantID, userID uuid.UUID, role string) error {
	if err := q.DeleteTenantUserRolesByUserID(ctx, userID); err != nil {
		return fmt.Errorf("delete tenant user roles: %w", err)
	}
	if _, err := q.CreateTenantUserRole(ctx, dbmodels.CreateTenantUserRoleParams{
		ID:       uuid.Must(uuid.NewV7()),
		TenantID: tenantID,
		UserID:   userID,
		Role:     role,
	}); err != nil {
		return fmt.Errorf("create tenant user role: %w", err)
	}
	return nil
}
