package main

import (
	"context"
	"database/sql"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"text/tabwriter"
	"time"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/fielderr"
	"github.com/publira/publira/server/internal/locale"
	"github.com/publira/publira/server/internal/platformtenants"
	"github.com/publira/publira/server/internal/tenantmembers"
)

var tenantGroup = commandGroup{
	name:    "tenant",
	summary: "Create and manage a tenant, its members, and its administrators",
	commands: []command{
		{
			name:    "create",
			summary: "Create a tenant with its default creator roles, and invite its first administrators",
			setup:   setupTenantCreate,
		},
		{
			name:    "show",
			summary: "Print a tenant",
			setup:   setupTenantShow,
		},
		{
			name:    "update",
			summary: "Change a tenant's name or domains",
			setup:   setupTenantUpdate,
		},
		{
			name:    "suspend",
			summary: "Stop serving a tenant",
			setup: func(f *commandFlags) func(context.Context, *commandEnv) error {
				return setupTenantStatus(f, platformtenants.Suspend, "Suspended")
			},
		},
		{
			name:    "resume",
			summary: "Serve a suspended tenant again",
			setup: func(f *commandFlags) func(context.Context, *commandEnv) error {
				return setupTenantStatus(f, platformtenants.Resume, "Resumed")
			},
		},
	},
	groups: []commandGroup{tenantMemberGroup, tenantInviteGroup, tenantAdminGroup},
}

// tenantFlags names the flag each refused field is given through. Every
// command takes its tenant as --tenant, whichever field the package calls it.
var tenantFlags = map[string]string{
	platformtenants.FieldTenant:             "--tenant",
	platformtenants.FieldPublicID:           "--tenant",
	platformtenants.FieldName:               "--name",
	platformtenants.FieldDomain:             "--domain",
	platformtenants.FieldAdminDomain:        "--admin-domain",
	platformtenants.FieldDefaultLocale:      "--default-locale",
	platformtenants.FieldInitialAdminEmails: "--initial-admin-email",
	tenantmembers.FieldUserPublicID:         "--user",
	tenantmembers.FieldEmail:                "--email",
	tenantmembers.FieldRole:                 "--role",
	tenantmembers.FieldPassword:             "--password-stdin",
	tenantmembers.FieldInvitationID:         "--id",
}

// tenantError names the flag behind what the tenant packages refused.
func tenantError(err error) error {
	if field := fielderr.Field(err); field != "" {
		return fmt.Errorf("%s: %w", tenantFlags[field], err)
	}
	switch {
	case errors.Is(err, platformtenants.ErrNoChange):
		return fmt.Errorf("--name, --domain, or --admin-domain: %w", err)
	case errors.Is(err, tenantmembers.ErrUserOrEmailRequired), errors.Is(err, tenantmembers.ErrUserAndEmailBothSet):
		return fmt.Errorf("--user or --email: %w", err)
	}
	return err
}

// tenantFlag declares --tenant, which names a tenant by public ID or domain.
func tenantFlag(f *commandFlags) *string {
	return f.String("tenant", "", "the tenant, by public ID or domain")
}

// inTenant runs fn in one transaction on the tenant ref names, and commits
// what fn wrote once it returns nil.
func (e *commandEnv) inTenant(ctx context.Context, ref string, fn func(tx *sql.Tx, tenant dbmodels.Tenant) error) error {
	db, err := e.openPlatformDB()
	if err != nil {
		return err
	}
	defer db.Close() //nolint:errcheck
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	tenant, err := platformtenants.Find(ctx, dbmodels.New(tx), ref)
	if err != nil {
		return tenantError(err)
	}
	if err := fn(tx, tenant); err != nil {
		return tenantError(err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	return nil
}

func setupTenantCreate(f *commandFlags) func(context.Context, *commandEnv) error {
	var params platformtenants.CreateParams
	f.StringVar(&params.Name, "name", "", "the tenant's name")
	f.StringVar(&params.Domain, "domain", "", "the host the tenant's site is served on")
	f.StringVar(&params.AdminDomain, "admin-domain", "", "the host the tenant's console is served on, if not the default one")
	f.StringVar(&params.DefaultLocale, "default-locale", "", "the tenant's language, one of "+strings.Join(locale.Supported, ", "))
	f.Func("initial-admin-email", "an address to invite as the tenant's administrator; repeat for several", func(email string) error {
		params.InitialAdminEmails = append(params.InitialAdminEmails, email)
		return nil
	})

	return func(ctx context.Context, env *commandEnv) error {
		creation, err := params.Validate()
		if err != nil {
			return tenantError(err)
		}

		db, err := env.openPlatformDB()
		if err != nil {
			return err
		}
		defer db.Close() //nolint:errcheck
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("begin: %w", err)
		}
		defer tx.Rollback() //nolint:errcheck

		created, err := platformtenants.Create(ctx, tx, env.logger, auditlog.SystemPlatformActor, creation)
		if err != nil {
			return tenantError(err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit: %w", err)
		}

		var out strings.Builder
		fmt.Fprintf(&out, "Created tenant %s for %s\n", created.Tenant.PublicID, created.Tenant.Domain)
		for _, invitation := range created.Invitations {
			fmt.Fprintf(&out, "Queued an invitation for %s\n", invitation.Email)
		}
		_, err = io.WriteString(env.stdout, out.String())
		return err
	}
}

func setupTenantShow(f *commandFlags) func(context.Context, *commandEnv) error {
	ref := tenantFlag(f)
	return func(ctx context.Context, env *commandEnv) error {
		return env.inTenant(ctx, *ref, func(_ *sql.Tx, tenant dbmodels.Tenant) error {
			adminDomain := "admin." + tenant.Domain + " (default)"
			if tenant.AdminDomain.Valid {
				adminDomain = tenant.AdminDomain.String
			}
			var b strings.Builder
			fmt.Fprintf(&b, "Public ID:\t%s\n", tenant.PublicID)
			fmt.Fprintf(&b, "Name:\t%s\n", tenant.Name)
			fmt.Fprintf(&b, "Status:\t%s\n", tenant.Status)
			fmt.Fprintf(&b, "Domain:\t%s\n", tenant.Domain)
			fmt.Fprintf(&b, "Admin domain:\t%s\n", adminDomain)
			fmt.Fprintf(&b, "Time zone:\t%s\n", tenant.Timezone)
			fmt.Fprintf(&b, "Default locale:\t%s\n", tenant.DefaultLocale)
			fmt.Fprintf(&b, "Created:\t%s\n", formatTime(tenant.CreatedAt))
			return printTable(env.stdout, b.String())
		})
	}
}

func setupTenantUpdate(f *commandFlags) func(context.Context, *commandEnv) error {
	ref := tenantFlag(f)
	name := f.String("name", "", "the tenant's new name")
	domain := f.String("domain", "", "the new host the tenant's site is served on")
	adminDomain := f.String("admin-domain", "", `the new host the tenant's console is served on; "" goes back to the default one`)
	return func(ctx context.Context, env *commandEnv) error {
		// Only a flag given changes anything, so a --admin-domain left out keeps
		// the tenant's while --admin-domain "" clears it.
		var params platformtenants.UpdateParams
		f.Visit(func(fl *flag.Flag) {
			switch fl.Name {
			case "name":
				params.Name = name
			case "domain":
				params.Domain = domain
			case "admin-domain":
				params.AdminDomain = adminDomain
			}
		})

		return env.inTenant(ctx, *ref, func(tx *sql.Tx, tenant dbmodels.Tenant) error {
			params.PublicID = tenant.PublicID
			change, err := params.Validate()
			if err != nil {
				return err
			}
			updated, err := platformtenants.Update(ctx, tx, env.logger, auditlog.SystemPlatformActor, change)
			if err != nil {
				return err
			}
			_, err = fmt.Fprintf(env.stdout, "Updated tenant %s for %s\n", updated.PublicID, updated.Domain)
			return err
		})
	}
}

type tenantStatusChange func(context.Context, *sql.Tx, *slog.Logger, auditlog.PlatformActor, string) (dbmodels.Tenant, error)

func setupTenantStatus(f *commandFlags, change tenantStatusChange, done string) func(context.Context, *commandEnv) error {
	ref := tenantFlag(f)
	return func(ctx context.Context, env *commandEnv) error {
		return env.inTenant(ctx, *ref, func(tx *sql.Tx, tenant dbmodels.Tenant) error {
			changed, err := change(ctx, tx, env.logger, auditlog.SystemPlatformActor, tenant.PublicID)
			if err != nil {
				return err
			}
			_, err = fmt.Fprintf(env.stdout, "%s tenant %s for %s\n", done, changed.PublicID, changed.Domain)
			return err
		})
	}
}

// printTable aligns the tab-separated cells of lines into columns on w.
func printTable(w io.Writer, lines string) error {
	tw := tabwriter.NewWriter(w, 0, 0, 2, ' ', 0)
	if _, err := io.WriteString(tw, lines); err != nil {
		return err
	}
	return tw.Flush()
}

func formatTime(t time.Time) string {
	return t.UTC().Format(time.RFC3339)
}
