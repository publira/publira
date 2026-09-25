package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	"github.com/publira/publira/server/internal/platformtenants"
	"github.com/publira/publira/server/internal/tenantmembers"
)

// listPageSize is how many rows a list command reads at a time; it prints
// every page.
const listPageSize = 100

var tenantMemberGroup = commandGroup{
	name:    "member",
	summary: "List and change who holds a console role in a tenant",
	commands: []command{
		{name: "list", summary: "Print every member of a tenant's console", setup: setupMemberList},
		{name: "add", summary: "Give a user of the tenant a console role", setup: setupMemberAdd},
		{name: "update-role", summary: "Change a member's console role", setup: setupMemberUpdateRole},
		{name: "remove", summary: "Take every console role from a member", setup: setupMemberRemove},
	},
}

var tenantInviteGroup = commandGroup{
	name:    "invite",
	summary: "Invite a tenant's administrators by mail",
	commands: []command{
		{name: "create", summary: "Invite an address to administer a tenant", setup: setupInviteCreate},
		{name: "list", summary: "Print every invitation of a tenant", setup: setupInviteList},
		{name: "resend", summary: "Mail an invitation again with a new link", setup: setupInviteResend},
		{name: "cancel", summary: "Withdraw an invitation", setup: setupInviteCancel},
	},
}

var tenantAdminGroup = commandGroup{
	name:    "admin",
	summary: "Create a tenant's console account directly, with no mail",
	commands: []command{
		{name: "create", summary: "Create a console account that signs in with a password", setup: setupAdminCreate},
	},
}

var roleUsage = "the console role, one of " + auth.RoleTenantAdmin + ", " + auth.RoleTenantEditor + ", " + auth.RoleTenantAuditor

func setupMemberList(f *commandFlags) func(context.Context, *commandEnv) error {
	ref := tenantFlag(f)
	return func(ctx context.Context, env *commandEnv) error {
		return env.inTenant(ctx, *ref, func(tx *sql.Tx, tenant dbmodels.Tenant) error {
			var b strings.Builder
			b.WriteString("USER\tEMAIL\tNAME\tROLE\tSTATUS\tCREATED\n")
			var keys pagination.TimeUUIDKeys
			for {
				rows, err := tenantmembers.ListMembers(ctx, dbmodels.New(tx), tenantmembers.ListParams{
					TenantID: tenant.ID, Keys: keys, Direction: pagination.Forward, Limit: listPageSize + 1,
				})
				if err != nil {
					return err
				}
				page, more := pagination.Page(rows, listPageSize, pagination.Forward)
				for _, m := range page {
					fmt.Fprintf(&b, "%s\t%s\t%s\t%s\t%s\t%s\n", m.PublicID, m.Email, m.Name, m.Role, m.Status, formatTime(m.CreatedAt))
				}
				if !more {
					return printTable(env.stdout, b.String())
				}
				last := page[len(page)-1]
				keys = pagination.TimeUUIDKeys{Time: last.CreatedAt, ID: last.UserID, Valid: true}
			}
		})
	}
}

func setupMemberAdd(f *commandFlags) func(context.Context, *commandEnv) error {
	ref := tenantFlag(f)
	var params tenantmembers.AddParams
	f.StringVar(&params.UserPublicID, "user", "", "the user, by public ID")
	f.StringVar(&params.Email, "email", "", "the user, by email address")
	f.StringVar(&params.Role, "role", "", roleUsage)
	return func(ctx context.Context, env *commandEnv) error {
		if err := params.Validate(); err != nil {
			return tenantError(err)
		}
		return env.inTenant(ctx, *ref, func(tx *sql.Tx, tenant dbmodels.Tenant) error {
			params.TenantID = tenant.ID
			member, err := tenantmembers.Add(ctx, tx, params)
			if err != nil {
				return err
			}
			_, err = fmt.Fprintf(env.stdout, "Gave %s (%s) the %s role\n", member.Email, member.PublicID, member.Role)
			return err
		})
	}
}

func setupMemberUpdateRole(f *commandFlags) func(context.Context, *commandEnv) error {
	ref := tenantFlag(f)
	var params tenantmembers.UpdateRoleParams
	f.StringVar(&params.UserPublicID, "user", "", "the member, by public ID")
	f.StringVar(&params.Role, "role", "", roleUsage)
	return func(ctx context.Context, env *commandEnv) error {
		if err := params.Validate(); err != nil {
			return tenantError(err)
		}
		return env.inTenant(ctx, *ref, func(tx *sql.Tx, tenant dbmodels.Tenant) error {
			params.TenantID = tenant.ID
			member, err := tenantmembers.UpdateRole(ctx, tx, params)
			if err != nil {
				return err
			}
			_, err = fmt.Fprintf(env.stdout, "Gave %s (%s) the %s role\n", member.Email, member.PublicID, member.Role)
			return err
		})
	}
}

func setupMemberRemove(f *commandFlags) func(context.Context, *commandEnv) error {
	ref := tenantFlag(f)
	var params tenantmembers.RemoveParams
	f.StringVar(&params.UserPublicID, "user", "", "the member, by public ID")
	return func(ctx context.Context, env *commandEnv) error {
		if err := params.Validate(); err != nil {
			return tenantError(err)
		}
		return env.inTenant(ctx, *ref, func(tx *sql.Tx, tenant dbmodels.Tenant) error {
			params.TenantID = tenant.ID
			member, err := tenantmembers.Remove(ctx, tx, params)
			if err != nil {
				return err
			}
			_, err = fmt.Fprintf(env.stdout, "Took every console role from %s (%s)\n", member.Email, member.PublicID)
			return err
		})
	}
}

func setupInviteCreate(f *commandFlags) func(context.Context, *commandEnv) error {
	ref := tenantFlag(f)
	var params tenantmembers.InviteParams
	f.StringVar(&params.Email, "email", "", "the address to invite")
	return func(ctx context.Context, env *commandEnv) error {
		if err := params.Validate(); err != nil {
			return tenantError(err)
		}
		return env.inTenant(ctx, *ref, func(tx *sql.Tx, tenant dbmodels.Tenant) error {
			params.TenantID = tenant.ID
			invited, err := platformtenants.Invite(ctx, tx, env.logger, auditlog.SystemPlatformActor, params)
			if err != nil {
				return err
			}
			if invited.RoleGrantedImmediately {
				_, err = fmt.Fprintf(env.stdout, "Gave %s the %s role: the address already has an account\n", invited.Email, auth.RoleTenantAdmin)
				return err
			}
			return printInvitation(env, "Queued an invitation", invited.Invitation)
		})
	}
}

func setupInviteList(f *commandFlags) func(context.Context, *commandEnv) error {
	ref := tenantFlag(f)
	return func(ctx context.Context, env *commandEnv) error {
		return env.inTenant(ctx, *ref, func(tx *sql.Tx, tenant dbmodels.Tenant) error {
			now := time.Now()
			var b strings.Builder
			b.WriteString("ID\tEMAIL\tSTATUS\tEXPIRES\n")
			var keys pagination.TimeUUIDKeys
			for {
				rows, err := tenantmembers.ListInvitations(ctx, dbmodels.New(tx), tenantmembers.ListParams{
					TenantID: tenant.ID, Keys: keys, Direction: pagination.Forward, Limit: listPageSize + 1,
				})
				if err != nil {
					return err
				}
				page, more := pagination.Page(rows, listPageSize, pagination.Forward)
				for _, invitation := range page {
					fmt.Fprintf(&b, "%s\t%s\t%s\t%s\n", invitation.ID, invitation.Email, tenantmembers.InvitationStatus(invitation, now), formatTime(invitation.ExpiresAt))
				}
				if !more {
					return printTable(env.stdout, b.String())
				}
				last := page[len(page)-1]
				keys = pagination.TimeUUIDKeys{Time: last.CreatedAt, ID: last.ID, Valid: true}
			}
		})
	}
}

func setupInviteResend(f *commandFlags) func(context.Context, *commandEnv) error {
	ref := tenantFlag(f)
	id := f.String("id", "", "the invitation, as invite list prints it")
	return func(ctx context.Context, env *commandEnv) error {
		invitationID, err := tenantmembers.ParseInvitationID(*id)
		if err != nil {
			return tenantError(err)
		}
		return env.inTenant(ctx, *ref, func(tx *sql.Tx, tenant dbmodels.Tenant) error {
			invitation, err := platformtenants.ResendInvitation(ctx, tx, env.logger, auditlog.SystemPlatformActor, tenantmembers.ResendParams{
				TenantID:     tenant.ID,
				InvitationID: invitationID,
			})
			if err != nil {
				return err
			}
			return printInvitation(env, "Queued the invitation again", invitation)
		})
	}
}

func setupInviteCancel(f *commandFlags) func(context.Context, *commandEnv) error {
	ref := tenantFlag(f)
	id := f.String("id", "", "the invitation, as invite list prints it")
	return func(ctx context.Context, env *commandEnv) error {
		invitationID, err := tenantmembers.ParseInvitationID(*id)
		if err != nil {
			return tenantError(err)
		}
		return env.inTenant(ctx, *ref, func(tx *sql.Tx, tenant dbmodels.Tenant) error {
			invitation, err := platformtenants.CancelInvitation(ctx, tx, env.logger, auditlog.SystemPlatformActor, tenantmembers.InvitationParams{
				TenantID:     tenant.ID,
				InvitationID: invitationID,
			})
			if err != nil {
				return err
			}
			_, err = fmt.Fprintf(env.stdout, "Canceled the invitation %s for %s\n", invitation.ID, invitation.Email)
			return err
		})
	}
}

func printInvitation(env *commandEnv, done string, invitation dbmodels.TenantAdminInvitation) error {
	_, err := fmt.Fprintf(env.stdout, "%s %s for %s, which expires at %s\n", done, invitation.ID, invitation.Email, formatTime(invitation.ExpiresAt))
	return err
}

func setupAdminCreate(f *commandFlags) func(context.Context, *commandEnv) error {
	ref := tenantFlag(f)
	var params tenantmembers.AccountParams
	f.StringVar(&params.Email, "email", "", "the address the account signs in with")
	f.StringVar(&params.Name, "name", "", "the name the console shows for the account")
	f.StringVar(&params.Role, "role", auth.RoleTenantAdmin, roleUsage)
	password := f.Secret("password", "password")
	generate := f.Bool("generate-password", false, "generate a password and print it once to stdout, instead of reading one")
	return func(ctx context.Context, env *commandEnv) error {
		if *generate && password.fromStdin {
			return errors.New("--generate-password and --password-stdin cannot both be given")
		}
		var err error
		if *generate {
			params.Password, err = generatePassword()
		} else {
			params.Password, err = password.read(env.console)
		}
		if err != nil {
			return err
		}
		if err := params.Validate(); err != nil {
			return tenantError(err)
		}

		return env.inTenant(ctx, *ref, func(tx *sql.Tx, tenant dbmodels.Tenant) error {
			params.TenantID = tenant.ID
			member, err := platformtenants.CreateAccount(ctx, tx, env.logger, auditlog.SystemPlatformActor, params)
			if err != nil {
				return err
			}
			// Printed before the commit, so a stdout that cannot be written
			// leaves no account whose password nobody saw.
			if _, err := fmt.Fprintf(env.stdout, "Created %s %s for %s\n", member.Role, member.PublicID, member.Email); err != nil {
				return err
			}
			if *generate {
				_, err = fmt.Fprintf(env.stdout, "Password: %s\n", params.Password)
			}
			return err
		})
	}
}

// generatePassword returns 144 random bits, spelled in 24 URL-safe characters
// so it survives a shell and a copy from a terminal.
func generatePassword() (string, error) {
	raw := make([]byte, 18)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("generate a password: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}
