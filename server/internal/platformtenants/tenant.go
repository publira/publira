package platformtenants

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/fielderr"
	"github.com/publira/publira/server/internal/publicid"
	"github.com/publira/publira/server/internal/tenantstatus"
)

// FieldTenant is the field [Find] refuses: a tenant named by public ID or by
// domain, which only publiractl accepts.
const FieldTenant = "tenant"

var (
	ErrNotFound         = errors.New("tenant not found")
	ErrPublicIDRequired = errors.New("public_id is required")
	ErrTenantIDRequired = errors.New("tenant_id is required")
	ErrTenantIDInvalid  = errors.New("tenant_id must be a UUID")
	ErrTenantRequired   = errors.New("tenant is required")
	// ErrNoChange refuses an update that sets nothing.
	ErrNoChange = errors.New("name, domain, or admin_domain is required")
)

// ParsePublicID trims the public ID a tenant is named by, refusing a blank
// one, without reading anything.
func ParsePublicID(raw string) (string, error) {
	publicID := strings.TrimSpace(raw)
	if publicID == "" {
		return "", &fielderr.Invalid{Field: FieldPublicID, Err: ErrPublicIDRequired}
	}
	return publicID, nil
}

// GetByID reads the tenant id names.
func GetByID(ctx context.Context, q dbmodels.Querier, id uuid.UUID) (dbmodels.Tenant, error) {
	return found(q.GetTenantByID(ctx, id))
}

// ParseID parses the tenant_id a request names a tenant by, without reading
// anything.
func ParseID(raw string) (uuid.UUID, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return uuid.Nil, &fielderr.Invalid{Field: FieldTenantID, Err: ErrTenantIDRequired}
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		return uuid.Nil, &fielderr.Invalid{Field: FieldTenantID, Err: ErrTenantIDInvalid}
	}
	return id, nil
}

// Get reads the tenant named by its public ID.
func Get(ctx context.Context, q dbmodels.Querier, rawPublicID string) (dbmodels.Tenant, error) {
	publicID, err := ParsePublicID(rawPublicID)
	if err != nil {
		return dbmodels.Tenant{}, err
	}
	return found(q.GetTenantByPublicID(ctx, publicID))
}

// Find reads the tenant ref names by its public ID or by its domain.
func Find(ctx context.Context, q dbmodels.Querier, ref string) (dbmodels.Tenant, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return dbmodels.Tenant{}, &fielderr.Invalid{Field: FieldTenant, Err: ErrTenantRequired}
	}
	if publicid.Valid(ref) {
		tenant, err := found(q.GetTenantByPublicID(ctx, ref))
		if !errors.Is(err, ErrNotFound) {
			return tenant, err
		}
	}
	return found(q.GetTenantByDomains(ctx, []string{ref}))
}

func found(tenant dbmodels.Tenant, err error) (dbmodels.Tenant, error) {
	if errors.Is(err, sql.ErrNoRows) {
		return dbmodels.Tenant{}, ErrNotFound
	}
	if err != nil {
		return dbmodels.Tenant{}, fmt.Errorf("get tenant: %w", err)
	}
	return tenant, nil
}

// UpdateParams replaces the name and domains of the tenant ID names.
// A nil field keeps what the tenant has; an AdminDomain of "" clears it.
type UpdateParams struct {
	ID          uuid.UUID
	Name        *string
	Domain      *string
	AdminDomain *string
}

// Change is an UpdateParams that passed [UpdateParams.Validate].
type Change struct {
	id          uuid.UUID
	name        *string
	domain      *string
	adminDomain *sql.NullString
}

// Validate normalizes p, or refuses it with a [*fielderr.Invalid], without
// reading anything.
func (p UpdateParams) Validate() (Change, error) {
	if p.ID == uuid.Nil {
		return Change{}, &fielderr.Invalid{Field: FieldTenantID, Err: ErrTenantIDRequired}
	}
	c := Change{id: p.ID}
	if p.Name != nil {
		name := strings.TrimSpace(*p.Name)
		if name == "" {
			return Change{}, &fielderr.Invalid{Field: FieldName, Err: ErrNameRequired}
		}
		c.name = &name
	}
	if p.Domain != nil {
		domain := strings.TrimSpace(*p.Domain)
		if domain == "" {
			return Change{}, &fielderr.Invalid{Field: FieldDomain, Err: ErrDomainRequired}
		}
		c.domain = &domain
	}
	if p.AdminDomain != nil {
		adminDomain := sql.NullString{String: strings.TrimSpace(*p.AdminDomain)}
		adminDomain.Valid = adminDomain.String != ""
		c.adminDomain = &adminDomain
	}
	if c.name == nil && c.domain == nil && c.adminDomain == nil {
		return Change{}, ErrNoChange
	}
	return c, nil
}

// Update writes c inside tx and files the entry under actor. A domain or admin
// domain another tenant serves, as its domain or as its console host, is
// refused with a [*fielderr.Conflict], and so is a change that moves the
// console host it implies onto one: clearing the admin domain, or a domain
// whose admin.{domain} is taken.
func Update(ctx context.Context, tx *sql.Tx, logger *slog.Logger, actor auditlog.PlatformActor, c Change) (dbmodels.Tenant, error) {
	q := dbmodels.New(tx)
	params := dbmodels.UpdateTenantInfoParams{ID: c.id}
	// Every change takes the lock before reading what it keeps, a rename alone
	// included: the write puts back the hosts it read, so a change to them that
	// committed in between would be undone, and a name another tenant claimed
	// once it was freed would be written back beside that claim unchecked.
	if err := lockHosts(ctx, q); err != nil {
		return dbmodels.Tenant{}, err
	}
	if c.name == nil || c.domain == nil || c.adminDomain == nil {
		current, err := found(q.GetTenantByID(ctx, c.id))
		if err != nil {
			return dbmodels.Tenant{}, err
		}
		params.Name, params.Domain, params.AdminDomain = current.Name, current.Domain, current.AdminDomain
	}
	if c.name != nil {
		params.Name = *c.name
	}
	if c.domain != nil {
		params.Domain = *c.domain
	}
	if c.adminDomain != nil {
		params.AdminDomain = *c.adminDomain
	}
	// A rename alone moves no host name, so it is not judged by them.
	if c.domain != nil || c.adminDomain != nil {
		if err := checkHosts(ctx, q, c.id, params.Domain, params.AdminDomain); err != nil {
			return dbmodels.Tenant{}, err
		}
	}

	tenant, err := q.UpdateTenantInfo(ctx, params)
	if err != nil {
		if field := uniqueViolationField(err); field != "" {
			return dbmodels.Tenant{}, &fielderr.Conflict{Field: field}
		}
		return found(tenant, err)
	}
	if err := writeTenantEntry(ctx, q, logger, actor, "tenant_info_updated", tenant); err != nil {
		return dbmodels.Tenant{}, err
	}
	return tenant, nil
}

// Suspend stops serving the tenant inside tx and files the entry under actor.
func Suspend(ctx context.Context, tx *sql.Tx, logger *slog.Logger, actor auditlog.PlatformActor, id uuid.UUID) (dbmodels.Tenant, error) {
	return setStatus(ctx, tx, logger, actor, id, tenantstatus.Suspended, "tenant_suspended")
}

// Resume serves a suspended tenant again inside tx and files the entry under
// actor.
func Resume(ctx context.Context, tx *sql.Tx, logger *slog.Logger, actor auditlog.PlatformActor, id uuid.UUID) (dbmodels.Tenant, error) {
	return setStatus(ctx, tx, logger, actor, id, tenantstatus.Active, "tenant_resumed")
}

func setStatus(ctx context.Context, tx *sql.Tx, logger *slog.Logger, actor auditlog.PlatformActor, id uuid.UUID, status, action string) (dbmodels.Tenant, error) {
	if id == uuid.Nil {
		return dbmodels.Tenant{}, &fielderr.Invalid{Field: FieldTenantID, Err: ErrTenantIDRequired}
	}
	q := dbmodels.New(tx)
	tenant, err := found(q.UpdateTenantStatus(ctx, dbmodels.UpdateTenantStatusParams{ID: id, Status: status}))
	if err != nil {
		return dbmodels.Tenant{}, err
	}
	if err := writeTenantEntry(ctx, q, logger, actor, action, tenant); err != nil {
		return dbmodels.Tenant{}, err
	}
	return tenant, nil
}

func writeTenantEntry(ctx context.Context, q *dbmodels.Queries, logger *slog.Logger, actor auditlog.PlatformActor, action string, tenant dbmodels.Tenant) error {
	if err := auditlog.WritePlatform(ctx, q, logger, actor.Entry(auditlog.PlatformEntry{
		TenantID:   tenant.ID,
		Action:     action,
		TargetType: "tenant",
		TargetID:   tenant.ID.String(),
		Outcome:    auditlog.OutcomeSuccess,
	})); err != nil {
		return fmt.Errorf("audit %s: %w", action, err)
	}
	return nil
}

// Sole reads the install's only tenant, reporting false when there is none or
// more than one.
func Sole(ctx context.Context, q dbmodels.Querier) (dbmodels.Tenant, bool, error) {
	tenants, err := q.ListTenantsAsc(ctx, dbmodels.ListTenantsAscParams{Limit: 2})
	if err != nil {
		return dbmodels.Tenant{}, false, fmt.Errorf("list tenants: %w", err)
	}
	if len(tenants) != 1 {
		return dbmodels.Tenant{}, false, nil
	}
	return tenants[0], true, nil
}
