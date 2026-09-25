// Package platformtenants holds what the platform does to a tenant, once, for
// the adapters that expose it: PlatformTenantService in api/platformapi, and
// the tenant group of publiractl. Neither adapter keeps any of it.
//
// Every write here files its platform audit entry inside the caller's
// transaction, under the actor the adapter names, so the change and its entry
// commit together. A refusal over a request field is a [*fielderr.Invalid] or
// a [*fielderr.Conflict].
package platformtenants

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strings"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/creatorroles"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/dberr"
	"github.com/publira/publira/server/internal/fielderr"
	"github.com/publira/publira/server/internal/locale"
	"github.com/publira/publira/server/internal/platformconfig"
	"github.com/publira/publira/server/internal/publicid"
	"github.com/publira/publira/server/internal/tenantmembers"
)

// The fields a refusal names, spelled as the PlatformTenantService requests
// spell them so the Connect adapter can report them as they are.
const (
	FieldPublicID           = "public_id"
	FieldName               = "name"
	FieldDomain             = "domain"
	FieldAdminDomain        = "admin_domain"
	FieldDefaultLocale      = "default_locale"
	FieldInitialAdminEmails = "initial_admin_emails"
)

var (
	ErrNameRequired              = errors.New("name is required")
	ErrDomainRequired            = errors.New("domain is required")
	ErrInvalidInitialAdminEmails = errors.New("invalid initial_admin_emails")
)

// CreateParams is a tenant as the operator asked for it.
type CreateParams struct {
	Name          string
	Domain        string
	AdminDomain   string
	DefaultLocale string
	// InitialAdminEmails are sent an invitation to administer the tenant.
	// Blank entries are skipped and repeats are sent one invitation.
	InitialAdminEmails []string
}

// Creation is a CreateParams that passed [CreateParams.Validate], which is the
// only way to get one.
type Creation struct {
	name               string
	domain             string
	adminDomain        sql.NullString
	defaultLocale      string
	initialAdminEmails []string
}

// Validate normalizes p, or refuses it with a [*fielderr.Invalid]. It reads
// nothing, so an adapter can refuse a request before it opens a transaction.
func (p CreateParams) Validate() (Creation, error) {
	c := Creation{
		name:   strings.TrimSpace(p.Name),
		domain: strings.TrimSpace(p.Domain),
	}
	if c.name == "" {
		return Creation{}, &fielderr.Invalid{Field: FieldName, Err: ErrNameRequired}
	}
	if c.domain == "" {
		return Creation{}, &fielderr.Invalid{Field: FieldDomain, Err: ErrDomainRequired}
	}
	if adminDomain := strings.TrimSpace(p.AdminDomain); adminDomain != "" {
		c.adminDomain = sql.NullString{String: adminDomain, Valid: true}
	}
	defaultLocale, err := locale.Normalize(p.DefaultLocale)
	if err != nil {
		return Creation{}, &fielderr.Invalid{Field: FieldDefaultLocale, Err: err}
	}
	c.defaultLocale = defaultLocale

	c.initialAdminEmails = make([]string, 0, len(p.InitialAdminEmails))
	seen := make(map[string]struct{}, len(p.InitialAdminEmails))
	for _, raw := range p.InitialAdminEmails {
		email, err := tenantmembers.NormalizeEmail(raw)
		if errors.Is(err, tenantmembers.ErrEmailRequired) {
			continue
		}
		if err != nil {
			return Creation{}, &fielderr.Invalid{Field: FieldInitialAdminEmails, Err: ErrInvalidInitialAdminEmails}
		}
		if _, ok := seen[email]; ok {
			continue
		}
		seen[email] = struct{}{}
		c.initialAdminEmails = append(c.initialAdminEmails, email)
	}
	return c, nil
}

// InitialAdminEmails are the normalized addresses [Create] will mail.
func (c Creation) InitialAdminEmails() []string {
	return slices.Clone(c.initialAdminEmails)
}

// Created is what [Create] wrote.
type Created struct {
	Tenant dbmodels.Tenant
	// Invitations are the initial administrators' invitations, whose mail is
	// queued on the outbox for the worker to send.
	Invitations []dbmodels.TenantAdminInvitation
}

// Create writes the tenant inside tx: the tenant row on the platform's default
// time zone, its default creator roles, an invitation for every initial
// administrator, and the audit entries filed under actor. The caller commits,
// so a tenant reaches the database with all of it or not at all.
//
// A domain or admin domain another tenant holds is refused with a
// [*fielderr.Conflict]; anything else is a failure of the database.
func Create(ctx context.Context, tx *sql.Tx, logger *slog.Logger, actor auditlog.PlatformActor, c Creation) (Created, error) {
	q := dbmodels.New(tx)

	tenantID, err := uuid.NewV7()
	if err != nil {
		return Created{}, err
	}
	// The time zone is applied explicitly instead of relying on the column
	// default, so an install that changed it starts every new tenant on it.
	// The locale comes from the request: the server never picks a language.
	timezone := platformconfig.DefaultTimeZone(ctx, q)

	tenant, err := publicid.InsertTx(ctx, tx, func(publicID string) (dbmodels.Tenant, error) {
		return q.CreateTenant(ctx, dbmodels.CreateTenantParams{
			ID:            tenantID,
			PublicID:      publicID,
			Domain:        c.domain,
			AdminDomain:   c.adminDomain,
			Name:          c.name,
			Timezone:      timezone,
			DefaultLocale: c.defaultLocale,
		})
	})
	if err != nil {
		if field := uniqueViolationField(err); field != "" {
			return Created{}, &fielderr.Conflict{Field: field}
		}
		return Created{}, fmt.Errorf("create tenant: %w", err)
	}

	if err := creatorroles.CreateDefaults(ctx, tx, tenant.ID); err != nil {
		return Created{}, fmt.Errorf("create default creator roles: %w", err)
	}
	if err := writeTenantEntry(ctx, q, logger, actor, "tenant_created", tenant); err != nil {
		return Created{}, err
	}

	// The tenant is new, so none of the addresses can belong to one of its
	// users yet: every initial administrator is invited.
	created := Created{Tenant: tenant, Invitations: make([]dbmodels.TenantAdminInvitation, 0, len(c.initialAdminEmails))}
	for _, email := range c.initialAdminEmails {
		invitation, err := tenantmembers.IssueInvitation(ctx, q, tenant.ID, email)
		if err != nil {
			return Created{}, fmt.Errorf("invite tenant admin: %w", err)
		}
		if err := writeInvitationEntry(ctx, q, logger, actor, "tenant_admin_invited", invitation.Email); err != nil {
			return Created{}, err
		}
		created.Invitations = append(created.Invitations, invitation)
	}
	return created, nil
}

// uniqueViolationField names the request field a unique violation on tenants
// is about, or "" when err is none of them. A public_id collision is not one:
// publicid.InsertTx retries it, and running out of attempts is a failure.
func uniqueViolationField(err error) string {
	switch dberr.UniqueViolationConstraint(err) {
	case "tenants_domain_key":
		return FieldDomain
	case "tenants_admin_domain_key":
		return FieldAdminDomain
	default:
		return ""
	}
}
