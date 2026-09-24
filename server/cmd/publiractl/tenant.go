package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/locale"
	"github.com/publira/publira/server/internal/platformtenants"
)

var tenantGroup = commandGroup{
	name:    "tenant",
	summary: "Create a tenant",
	commands: []command{{
		name:    "create",
		summary: "Create a tenant with its default creator roles, and invite its first administrators",
		setup:   setupTenantCreate,
	}},
}

// tenantFlags names the flag each platformtenants field is given through.
var tenantFlags = map[string]string{
	platformtenants.FieldName:               "-name",
	platformtenants.FieldDomain:             "-domain",
	platformtenants.FieldAdminDomain:        "-admin-domain",
	platformtenants.FieldDefaultLocale:      "-default-locale",
	platformtenants.FieldInitialAdminEmails: "-initial-admin-email",
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

// tenantError names the flag behind a field platformtenants refused.
func tenantError(err error) error {
	var invalid *platformtenants.InvalidError
	if errors.As(err, &invalid) {
		return fmt.Errorf("%s: %w", tenantFlags[invalid.Field], err)
	}
	var conflict *platformtenants.ConflictError
	if errors.As(err, &conflict) {
		return fmt.Errorf("%s: %w", tenantFlags[conflict.Field], err)
	}
	return err
}
