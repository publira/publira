// Package tenantmembers holds what a tenant's console members and its
// administrator invitations are, for every surface that manages them: the
// Platform Console and publiractl on any tenant, and a tenant administrator on
// their own. Nothing here speaks Connect; each adapter maps the errors below to
// its own codes, and reports the field a [*fielderr.Invalid] names.
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
	"github.com/publira/publira/server/internal/dberr"
	"github.com/publira/publira/server/internal/fielderr"
	"github.com/publira/publira/server/internal/pagination"
	"github.com/publira/publira/server/internal/publicid"
	"github.com/publira/publira/server/internal/tenantlock"
)

// The fields a refusal names, spelled as the Connect requests spell them.
const (
	FieldUserPublicID = "user_public_id"
	FieldEmail        = "email"
	FieldRole         = "role"
	FieldName         = "name"
	FieldPassword     = "password"
	FieldInvitationID = "invitation_id"
)

var (
	ErrUserPublicIDRequired = errors.New("user_public_id is required")
	ErrInvalidRole          = errors.New("invalid role")
	ErrMemberNotFound       = errors.New("member not found")
	// ErrLastAdmin refuses a change that would leave the tenant with no active
	// tenant_admin, and so with nobody who can sign in to manage it.
	ErrLastAdmin = errors.New("the tenant's last active tenant_admin cannot be removed or demoted")

	ErrUserOrEmailRequired = errors.New("user_public_id or email is required")
	ErrUserAndEmailBothSet = errors.New("user_public_id and email cannot both be set")
	ErrAlreadyMember       = errors.New("user already has tenant roles")
	ErrRoleAlreadyHeld     = errors.New("user already has this role")
	ErrNameRequired        = errors.New("name is required")
	ErrPasswordRequired    = errors.New("password is required")
)

// invalid refuses err under field, keeping err for errors.Is.
func invalid(field string, err error) error {
	return &fielderr.Invalid{Field: field, Err: err}
}

// normalizeRole is [NormalizeRole] refusing anything else under the role field.
func normalizeRole(raw string) (string, error) {
	role, ok := NormalizeRole(raw)
	if !ok {
		return "", invalid(FieldRole, ErrInvalidRole)
	}
	return role, nil
}

// normalizeEmail is [NormalizeEmail] refusing under the email field.
func normalizeEmail(raw string) (string, error) {
	email, err := NormalizeEmail(raw)
	if err != nil {
		return "", invalid(FieldEmail, err)
	}
	return email, nil
}

func userPublicID(raw string) (string, error) {
	publicID := strings.TrimSpace(raw)
	if publicID == "" {
		return "", invalid(FieldUserPublicID, ErrUserPublicIDRequired)
	}
	return publicID, nil
}

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

// Validate refuses p over a field without reading anything, so an adapter can
// refuse it before it looks the tenant up.
func (p UpdateRoleParams) Validate() error {
	if _, err := userPublicID(p.UserPublicID); err != nil {
		return err
	}
	_, err := normalizeRole(p.Role)
	return err
}

// UpdateRole replaces the member's roles with the one p names, inside tx.
func UpdateRole(ctx context.Context, tx *sql.Tx, p UpdateRoleParams) (Member, error) {
	if err := p.Validate(); err != nil {
		return Member{}, err
	}
	role, _ := NormalizeRole(p.Role)
	member, err := findMember(ctx, tx, p.TenantID, p.UserPublicID, p.KeepAnAdmin)
	if err != nil {
		return Member{}, err
	}
	if p.KeepAnAdmin && role != auth.RoleTenantAdmin {
		if err := refuseLastAdmin(ctx, tx, p.TenantID, member); err != nil {
			return Member{}, err
		}
	}

	if err := ReplaceRole(ctx, dbmodels.New(tx), p.TenantID, member.UserID, role); err != nil {
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

// Validate refuses p over a field without reading anything.
func (p RemoveParams) Validate() error {
	_, err := userPublicID(p.UserPublicID)
	return err
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
	publicID, err := userPublicID(rawPublicID)
	if err != nil {
		return Member{}, err
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

// ReplaceRole leaves userID holding role and no other console role in the tenant.
func ReplaceRole(ctx context.Context, q *dbmodels.Queries, tenantID, userID uuid.UUID, role string) error {
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

// AddParams gives a user the tenant already has a console role. The user is
// named by public ID or by email, never both.
type AddParams struct {
	TenantID     uuid.UUID
	UserPublicID string
	Email        string
	Role         string
}

// Validate refuses p without reading anything.
func (p AddParams) Validate() error {
	_, _, _, err := p.normalize()
	return err
}

func (p AddParams) normalize() (publicID, email, role string, err error) {
	publicID = strings.TrimSpace(p.UserPublicID)
	email = strings.TrimSpace(p.Email)
	switch {
	case publicID == "" && email == "":
		return "", "", "", ErrUserOrEmailRequired
	case publicID != "" && email != "":
		return "", "", "", ErrUserAndEmailBothSet
	}
	if email != "" {
		if email, err = normalizeEmail(email); err != nil {
			return "", "", "", err
		}
	}
	if role, err = normalizeRole(p.Role); err != nil {
		return "", "", "", err
	}
	return publicID, email, role, nil
}

// Add gives the user p names the role inside tx. A user who already holds a
// console role is refused with [ErrAlreadyMember]: changing it is
// [UpdateRole]'s.
func Add(ctx context.Context, tx *sql.Tx, p AddParams) (Member, error) {
	publicID, email, role, err := p.normalize()
	if err != nil {
		return Member{}, err
	}
	q := dbmodels.New(tx)

	var member Member
	if publicID != "" {
		user, err := q.GetUserByPublicIDForTenant(ctx, dbmodels.GetUserByPublicIDForTenantParams{
			TenantID: uuid.NullUUID{UUID: p.TenantID, Valid: true},
			PublicID: publicID,
		})
		if err != nil {
			return Member{}, lookupError(err)
		}
		member = Member{UserID: user.ID, PublicID: user.PublicID, Name: user.Name, Email: user.Email, Status: user.Status, CreatedAt: user.CreatedAt}
	} else {
		user, err := q.GetUserByEmailForTenant(ctx, dbmodels.GetUserByEmailForTenantParams{
			TenantID: uuid.NullUUID{UUID: p.TenantID, Valid: true},
			Email:    email,
		})
		if err != nil {
			return Member{}, lookupError(err)
		}
		member = Member{UserID: user.ID, PublicID: user.PublicID, Name: user.Name, Email: user.Email, Status: user.Status, CreatedAt: user.CreatedAt}
	}

	roles, err := q.ListTenantUserRoles(ctx, member.UserID)
	if err != nil {
		return Member{}, fmt.Errorf("list tenant user roles: %w", err)
	}
	if len(roles) > 0 {
		return Member{}, ErrAlreadyMember
	}
	if _, err := q.CreateTenantUserRole(ctx, dbmodels.CreateTenantUserRoleParams{
		ID:       uuid.Must(uuid.NewV7()),
		TenantID: p.TenantID,
		UserID:   member.UserID,
		Role:     role,
	}); err != nil {
		if dberr.IsUniqueViolation(err) {
			return Member{}, ErrRoleAlreadyHeld
		}
		return Member{}, fmt.Errorf("create tenant user role: %w", err)
	}
	member.Role = role
	return member, nil
}

func lookupError(err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return ErrMemberNotFound
	}
	return fmt.Errorf("get tenant member: %w", err)
}

// AccountParams is a user the tenant does not have yet, holding a console
// role from the start.
type AccountParams struct {
	TenantID uuid.UUID
	Email    string
	Name     string
	// Password is hashed as given.
	Password string
	Role     string
}

// Validate refuses p without reading anything.
func (p AccountParams) Validate() error {
	if _, err := normalizeEmail(p.Email); err != nil {
		return err
	}
	if strings.TrimSpace(p.Name) == "" {
		return invalid(FieldName, ErrNameRequired)
	}
	if p.Password == "" {
		return invalid(FieldPassword, ErrPasswordRequired)
	}
	_, err := normalizeRole(p.Role)
	return err
}

// CreateAccount creates the user inside tx, active and with its email marked
// verified, and gives it the role. No mail is sent: whoever holds the password
// signs in with it. An address that already belongs to a user of the tenant is
// refused with a [*fielderr.Conflict] on the email field.
func CreateAccount(ctx context.Context, tx *sql.Tx, p AccountParams) (Member, error) {
	if err := p.Validate(); err != nil {
		return Member{}, err
	}
	email, _ := NormalizeEmail(p.Email)
	role, _ := NormalizeRole(p.Role)
	q := dbmodels.New(tx)

	passwordHash, err := auth.HashPassword(p.Password)
	if err != nil {
		return Member{}, fmt.Errorf("hash password: %w", err)
	}
	userID, err := uuid.NewV7()
	if err != nil {
		return Member{}, err
	}
	user, err := publicid.InsertTx(ctx, tx, func(publicID string) (dbmodels.User, error) {
		return q.CreateUser(ctx, dbmodels.CreateUserParams{
			ID:           userID,
			TenantID:     uuid.NullUUID{UUID: p.TenantID, Valid: true},
			PublicID:     publicID,
			Email:        email,
			PasswordHash: passwordHash,
			Name:         strings.TrimSpace(p.Name),
		})
	})
	if err != nil {
		if dberr.UniqueViolationConstraint(err) == "idx_users_tenant_id_email" {
			return Member{}, &fielderr.Conflict{Field: FieldEmail}
		}
		return Member{}, fmt.Errorf("create user: %w", err)
	}
	if user, err = q.UpdateUserEmailVerifiedAtByID(ctx, dbmodels.UpdateUserEmailVerifiedAtByIDParams{
		ID:              user.ID,
		EmailVerifiedAt: sql.NullTime{Time: time.Now(), Valid: true},
	}); err != nil {
		return Member{}, fmt.Errorf("verify user email: %w", err)
	}
	if user.Status != "active" {
		if user, err = q.UpdateUserStatusByID(ctx, dbmodels.UpdateUserStatusByIDParams{ID: user.ID, Status: "active"}); err != nil {
			return Member{}, fmt.Errorf("activate user: %w", err)
		}
	}
	if err := ReplaceRole(ctx, q, p.TenantID, user.ID, role); err != nil {
		return Member{}, err
	}
	return Member{UserID: user.ID, PublicID: user.PublicID, Name: user.Name, Email: user.Email, Role: role, Status: user.Status, CreatedAt: user.CreatedAt}, nil
}
