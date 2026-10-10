package platformtenants

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/tenantmembers"
)

// Invite is [tenantmembers.Invite] with its entry filed under actor.
func Invite(ctx context.Context, tx *sql.Tx, logger *slog.Logger, actor auditlog.PlatformActor, p tenantmembers.InviteParams) (tenantmembers.Invited, error) {
	invited, err := tenantmembers.Invite(ctx, tx, p)
	if err != nil {
		return tenantmembers.Invited{}, err
	}
	if invited.RoleGrantedImmediately {
		err = writeUserEntry(ctx, tx, logger, actor, "tenant_admin_invited", p.TenantID, invited.UserID)
	} else {
		err = writeInvitationEntry(ctx, dbmodels.New(tx), logger, actor, "tenant_admin_invited", invited.Invitation)
	}
	if err != nil {
		return tenantmembers.Invited{}, err
	}
	return invited, nil
}

// ResendInvitation is [tenantmembers.Resend] with its entry filed under actor.
func ResendInvitation(ctx context.Context, tx *sql.Tx, logger *slog.Logger, actor auditlog.PlatformActor, p tenantmembers.ResendParams) (dbmodels.TenantAdminInvitation, error) {
	invitation, err := tenantmembers.Resend(ctx, tx, p)
	if err != nil {
		return dbmodels.TenantAdminInvitation{}, err
	}
	if err := writeInvitationEntry(ctx, dbmodels.New(tx), logger, actor, "tenant_admin_invite_resent", invitation); err != nil {
		return dbmodels.TenantAdminInvitation{}, err
	}
	return invitation, nil
}

// CancelInvitation is [tenantmembers.Cancel] inside tx, with its entry filed
// under actor.
func CancelInvitation(ctx context.Context, tx *sql.Tx, logger *slog.Logger, actor auditlog.PlatformActor, p tenantmembers.InvitationParams) (dbmodels.TenantAdminInvitation, error) {
	q := dbmodels.New(tx)
	invitation, err := tenantmembers.Cancel(ctx, q, p)
	if err != nil {
		return dbmodels.TenantAdminInvitation{}, err
	}
	if err := writeInvitationEntry(ctx, q, logger, actor, "tenant_admin_invite_canceled", invitation); err != nil {
		return dbmodels.TenantAdminInvitation{}, err
	}
	return invitation, nil
}

// CreateAccount is [tenantmembers.CreateAccount] with its entry filed under
// actor. The entry names the user, never the password.
func CreateAccount(ctx context.Context, tx *sql.Tx, logger *slog.Logger, actor auditlog.PlatformActor, p tenantmembers.AccountParams) (tenantmembers.Member, error) {
	member, err := tenantmembers.CreateAccount(ctx, tx, p)
	if err != nil {
		return tenantmembers.Member{}, err
	}
	if err := writeUserEntry(ctx, tx, logger, actor, "tenant_member_created", p.TenantID, member.UserID); err != nil {
		return tenantmembers.Member{}, err
	}
	return member, nil
}

// AddMember is [tenantmembers.Add] with its entry filed under actor.
func AddMember(ctx context.Context, tx *sql.Tx, logger *slog.Logger, actor auditlog.PlatformActor, p tenantmembers.AddParams) (tenantmembers.Member, error) {
	member, err := tenantmembers.Add(ctx, tx, p)
	if err != nil {
		return tenantmembers.Member{}, err
	}
	if err := writeUserEntry(ctx, tx, logger, actor, "tenant_member_added", p.TenantID, member.UserID); err != nil {
		return tenantmembers.Member{}, err
	}
	return member, nil
}

// UpdateMemberRole is [tenantmembers.UpdateRole] with its entry filed under
// actor.
func UpdateMemberRole(ctx context.Context, tx *sql.Tx, logger *slog.Logger, actor auditlog.PlatformActor, p tenantmembers.UpdateRoleParams) (tenantmembers.Member, error) {
	member, err := tenantmembers.UpdateRole(ctx, tx, p)
	if err != nil {
		return tenantmembers.Member{}, err
	}
	if err := writeUserEntry(ctx, tx, logger, actor, "tenant_member_role_updated", p.TenantID, member.UserID); err != nil {
		return tenantmembers.Member{}, err
	}
	return member, nil
}

// RemoveMember is [tenantmembers.Remove] with its entry filed under actor.
func RemoveMember(ctx context.Context, tx *sql.Tx, logger *slog.Logger, actor auditlog.PlatformActor, p tenantmembers.RemoveParams) (tenantmembers.Member, error) {
	member, err := tenantmembers.Remove(ctx, tx, p)
	if err != nil {
		return tenantmembers.Member{}, err
	}
	if err := writeUserEntry(ctx, tx, logger, actor, "tenant_member_removed", p.TenantID, member.UserID); err != nil {
		return tenantmembers.Member{}, err
	}
	return member, nil
}

// ResetMemberMFA is [tenantmembers.ResetMFA] with its entry filed under actor.
func ResetMemberMFA(ctx context.Context, tx *sql.Tx, logger *slog.Logger, actor auditlog.PlatformActor, p tenantmembers.ResetMFAParams) (tenantmembers.Member, error) {
	member, err := tenantmembers.ResetMFA(ctx, tx, p)
	if err != nil {
		return tenantmembers.Member{}, err
	}
	if err := writeUserEntry(ctx, tx, logger, actor, "tenant_member_mfa_reset", p.TenantID, member.UserID); err != nil {
		return tenantmembers.Member{}, err
	}
	return member, nil
}

// writeUserEntry names the user, filed under the tenant whose role it is.
func writeUserEntry(ctx context.Context, tx *sql.Tx, logger *slog.Logger, actor auditlog.PlatformActor, action string, tenantID, userID uuid.UUID) error {
	if err := auditlog.WritePlatform(ctx, dbmodels.New(tx), logger, actor.Entry(auditlog.PlatformEntry{
		TenantID:   tenantID,
		Action:     action,
		TargetType: "user",
		TargetID:   userID.String(),
		Outcome:    auditlog.OutcomeSuccess,
	})); err != nil {
		return fmt.Errorf("audit %s: %w", action, err)
	}
	return nil
}

// writeInvitationEntry names the invitation, whose row carries its address, and
// files it under the invitation's tenant.
func writeInvitationEntry(ctx context.Context, q *dbmodels.Queries, logger *slog.Logger, actor auditlog.PlatformActor, action string, invitation dbmodels.TenantAdminInvitation) error {
	if err := auditlog.WritePlatform(ctx, q, logger, actor.Entry(auditlog.PlatformEntry{
		TenantID:   invitation.TenantID,
		Action:     action,
		TargetType: "tenant_admin_invitation",
		TargetID:   invitation.ID.String(),
		Outcome:    auditlog.OutcomeSuccess,
	})); err != nil {
		return fmt.Errorf("audit %s: %w", action, err)
	}
	return nil
}
