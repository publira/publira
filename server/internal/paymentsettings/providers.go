package paymentsettings

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/paymentprovider"
)

// ErrProviderNotHeld reports a provider the tenant does not hold.
var ErrProviderNotHeld = errors.New("the tenant does not hold the payment provider")

// ProviderConfig is the non-secret view of one payment provider a tenant
// holds. It is safe to return from APIs and to log.
type ProviderConfig struct {
	TenantID uuid.UUID
	Provider string
	Enabled  bool
	// Retired reports a provider the tenant removed while it still had
	// payments a refund may reach or subscriptions it bills. It starts no
	// checkout, and its credentials still serve what it already took.
	Retired bool
	// Fields has one entry per field the provider declares, in its order.
	Fields []FieldState
	// Ready reports that the provider is enabled and holds every field it
	// requires. A provider this build does not register is never ready.
	Ready     bool
	CreatedAt time.Time
	UpdatedAt time.Time
}

// Field answers the state of the field named name.
func (c ProviderConfig) Field(name string) (FieldState, bool) {
	for _, field := range c.Fields {
		if field.Name == name {
			return field, true
		}
	}
	return FieldState{}, false
}

// Sells reports whether a checkout may be sent to the provider.
func (c ProviderConfig) Sells() bool {
	return c.Ready && !c.Retired
}

// Providers is every payment provider a tenant holds, in the order it added
// them, beside the currency all of them sell in.
type Providers struct {
	TenantID uuid.UUID
	// List holds the retired providers too.
	List []ProviderConfig
	// Currency is the ISO 4217 code, in capitals, of the currency the tenant
	// sells in.
	Currency string
	// CurrencyLocked reports that the tenant has a purchase, so Currency can
	// no longer change.
	CurrencyLocked bool
}

// Lookup answers the provider of p whose id is provider.
func (p Providers) Lookup(provider string) (ProviderConfig, bool) {
	for _, config := range p.List {
		if config.Provider == provider {
			return config, true
		}
	}
	return ProviderConfig{}, false
}

// ProviderInput saves one provider of a tenant's.
type ProviderInput struct {
	Provider string
	Enabled  bool
	// Currency is the ISO 4217 code to sell in, which this provider and every
	// other one the tenant sells through have to charge in. Empty keeps the
	// stored one, which is the platform's default before any is saved.
	Currency string
	// Fields the input leaves out are left as they are.
	Fields []FieldUpdate
}

// Held answers every provider tenantID holds, retired ones included, in the
// order it added them. It decrypts nothing.
func (s *Store) Held(ctx context.Context, tenantID uuid.UUID) ([]ProviderConfig, error) {
	rows, err := s.queries.ListTenantPaymentProviders(ctx, tenantID)
	if err != nil {
		s.logger.ErrorContext(ctx, "failed to list tenant payment providers",
			"tenant_id", tenantID,
			"error", err,
		)
		return nil, err
	}
	configs := make([]ProviderConfig, 0, len(rows))
	for _, row := range rows {
		config, err := s.providerConfig(row)
		if err != nil {
			return nil, err
		}
		configs = append(configs, config)
	}
	return configs, nil
}

// Providers answers every provider tenantID holds, with the currency it sells
// in and whether that is locked.
func (s *Store) Providers(ctx context.Context, tenantID uuid.UUID) (Providers, error) {
	held, err := s.Held(ctx, tenantID)
	if err != nil {
		return Providers{}, err
	}
	currency, err := s.Currency(ctx, tenantID)
	if err != nil {
		return Providers{}, err
	}
	locked, err := s.currencyLocked(ctx, tenantID)
	if err != nil {
		return Providers{}, err
	}
	return Providers{TenantID: tenantID, List: held, Currency: currency, CurrencyLocked: locked}, nil
}

// UpsertProvider adds input's provider beside the ones tenantID holds, or
// changes the one it holds, encrypting the fields it replaces, and records a
// tenant audit event naming the fields it touched. Saving a retired provider
// adds it back. Every other provider is left as it is. Run it in a
// transaction: it writes the tenant's currency and the provider apart.
func (s *Store) UpsertProvider(ctx context.Context, tenantID uuid.UUID, input ProviderInput, audit AuditMeta) (Providers, error) {
	provider, ok := s.providers.Lookup(strings.TrimSpace(input.Provider))
	if !ok {
		return Providers{}, ErrInvalidProvider
	}
	declaration := provider.Declaration()

	// Taken before the current currency is read, as Upsert takes it, and so
	// that two saves of the tenant's providers do not interleave.
	if err := s.queries.LockTenantCurrency(ctx, tenantID); err != nil {
		return Providers{}, fmt.Errorf("hold the tenant currency: %w", err)
	}
	settings, found, err := s.loadRow(ctx, tenantID)
	if err != nil {
		return Providers{}, err
	}
	currency, currencyChanged, _, err := s.resolveCurrency(ctx, tenantID, settings, found, input.Currency)
	if err != nil {
		return Providers{}, err
	}
	if !declaration.Charges(currency) {
		return Providers{}, fmt.Errorf("%w: %s does not charge in %q", ErrUnsupportedCurrency, declaration.ID, currency)
	}
	rows, err := s.queries.ListTenantPaymentProviders(ctx, tenantID)
	if err != nil {
		return Providers{}, err
	}
	if err := s.othersCharge(rows, currency, declaration.ID); err != nil {
		return Providers{}, err
	}
	stored := storedFields{encrypted: map[string]string{}, hints: map[string]string{}}
	for _, row := range rows {
		if row.Provider != declaration.ID {
			continue
		}
		if stored, err = decodeStoredFields(row.CredentialsEncrypted, row.CredentialHints); err != nil {
			return Providers{}, err
		}
	}

	touched, err := s.applyFieldUpdates(declaration, stored, input.Fields)
	if err != nil {
		return Providers{}, err
	}
	if input.Enabled {
		if missing := missingRequired(declaration, stored); len(missing) > 0 {
			return Providers{}, fmt.Errorf("%w: %s", ErrFieldsRequired, strings.Join(missing, ", "))
		}
	}
	encrypted, hints, err := stored.marshal()
	if err != nil {
		return Providers{}, err
	}

	// The settings row holds the currency, and is the one the previous
	// release reads the tenant's first provider from, so it is there before
	// the provider is.
	if !found || currencyChanged {
		if err := s.queries.SaveTenantCurrency(ctx, dbmodels.SaveTenantCurrencyParams{
			TenantID: tenantID,
			Provider: declaration.ID,
			Currency: currency,
		}); err != nil {
			s.logger.ErrorContext(ctx, "failed to persist the tenant currency",
				"tenant_id", tenantID,
				"error", err,
			)
			return Providers{}, err
		}
	}
	if _, err := s.queries.UpsertTenantPaymentProvider(ctx, dbmodels.UpsertTenantPaymentProviderParams{
		TenantID:             tenantID,
		Provider:             declaration.ID,
		Enabled:              input.Enabled,
		CredentialsEncrypted: encrypted,
		CredentialHints:      hints,
	}); err != nil {
		s.logger.ErrorContext(ctx, "failed to persist a tenant payment provider",
			"tenant_id", tenantID,
			"provider", declaration.ID,
			"error", err,
		)
		return Providers{}, err
	}

	if currencyChanged {
		touched = append(touched, "currency")
	}
	s.recordUpdate(ctx, tenantID, audit, auditlog.OutcomeSuccess, touchedReason(touched))
	return s.Providers(ctx, tenantID)
}

// RetiredProviderGrace is how long a retired provider keeps its credentials
// before removing it again deletes them. Nothing records the checkouts a
// provider has started, and a checkout can be paid long after it started:
// Stripe lets a konbini voucher run for up to 60 days and retries a
// notification for 3 days more, and states no deadline for a bank transfer.
// 90 days is how long Stripe holds a transfer it cannot match before it gives
// the money up, the longest wait either provider documents.
const RetiredProviderGrace = 90 * 24 * time.Hour

// RemoveProvider retires provider, one of the ones tenantID holds, and reports
// whether the tenant still holds it. A retired provider sells no more and
// keeps its credentials for what it already took, which includes a checkout
// started before it was removed and paid since. Removing a retired provider
// again deletes it, once [RetiredProviderGrace] has passed since it was
// retired and it has no payment a refund may reach and no subscription it
// bills; until then it stays retired. A provider the tenant does not hold is
// [ErrProviderNotHeld]. Run it in a transaction.
func (s *Store) RemoveProvider(ctx context.Context, tenantID uuid.UUID, provider string, audit AuditMeta) (Providers, bool, error) {
	provider = strings.TrimSpace(provider)
	if err := s.queries.LockTenantCurrency(ctx, tenantID); err != nil {
		return Providers{}, false, fmt.Errorf("hold the tenant currency: %w", err)
	}
	row, err := s.queries.GetTenantPaymentProvider(ctx, dbmodels.GetTenantPaymentProviderParams{TenantID: tenantID, Provider: provider})
	if errors.Is(err, sql.ErrNoRows) {
		return Providers{}, false, ErrProviderNotHeld
	}
	if err != nil {
		return Providers{}, false, err
	}
	removed, err := s.removable(ctx, row)
	if err != nil {
		return Providers{}, false, err
	}
	switch {
	case removed:
		if _, err := s.queries.DeleteTenantPaymentProvider(ctx, dbmodels.DeleteTenantPaymentProviderParams{TenantID: tenantID, Provider: provider}); err != nil {
			return Providers{}, false, err
		}
		s.recordUpdate(ctx, tenantID, audit, auditlog.OutcomeSuccess, "removed: "+provider)
	case !row.RetiredAt.Valid:
		if _, err := s.queries.RetireTenantPaymentProvider(ctx, dbmodels.RetireTenantPaymentProviderParams{TenantID: tenantID, Provider: provider}); err != nil {
			return Providers{}, false, err
		}
		s.recordUpdate(ctx, tenantID, audit, auditlog.OutcomeSuccess, "retired: "+provider)
	}
	providers, err := s.Providers(ctx, tenantID)
	return providers, !removed, err
}

// removable reports whether row, a provider the tenant holds, may be deleted:
// retired for longer than [RetiredProviderGrace], with nothing of the
// tenant's left for it to act on.
func (s *Store) removable(ctx context.Context, row dbmodels.TenantPaymentProvider) (bool, error) {
	if !row.RetiredAt.Valid || time.Since(row.RetiredAt.Time) < RetiredProviderGrace {
		return false, nil
	}
	open, err := s.queries.TenantPaymentProviderHasOpenPayments(ctx, dbmodels.TenantPaymentProviderHasOpenPaymentsParams{TenantID: row.TenantID, Provider: row.Provider})
	if err != nil {
		return false, err
	}
	return !open, nil
}

// LoadProvider decrypts the credentials of the provider tenantID holds under
// provider, keyed by the field names it declares, retired or not. This is the
// only method that returns plaintext. A
// provider the tenant does not hold, or holds disabled, incomplete, or
// undecryptable, yields a sentinel error with no secret material.
func (s *Store) LoadProvider(ctx context.Context, tenantID uuid.UUID, provider string) (ProviderConfig, paymentprovider.Credentials, error) {
	row, err := s.queries.GetTenantPaymentProvider(ctx, dbmodels.GetTenantPaymentProviderParams{TenantID: tenantID, Provider: provider})
	if errors.Is(err, sql.ErrNoRows) {
		return ProviderConfig{}, nil, ErrProviderNotHeld
	}
	if err != nil {
		s.logger.ErrorContext(ctx, "failed to load a tenant payment provider",
			"tenant_id", tenantID,
			"provider", provider,
			"error", err,
		)
		return ProviderConfig{}, nil, err
	}
	if !row.Enabled {
		return ProviderConfig{}, nil, ErrNotEnabled
	}
	registered, ok := s.providers.Lookup(row.Provider)
	if !ok {
		s.logger.ErrorContext(ctx, "tenant payment provider is not registered",
			"tenant_id", tenantID,
			"provider", row.Provider,
		)
		return ProviderConfig{}, nil, ErrProviderUnavailable
	}
	stored, err := decodeStoredFields(row.CredentialsEncrypted, row.CredentialHints)
	if err != nil {
		return ProviderConfig{}, nil, err
	}
	credentials, err := s.decryptCredentials(ctx, tenantID, registered.Declaration(), stored)
	if err != nil {
		return ProviderConfig{}, nil, err
	}
	config, err := s.providerConfig(row)
	if err != nil {
		return ProviderConfig{}, nil, err
	}
	return config, credentials, nil
}

// PlanProvider answers the provider of held the tenant's subscription plans
// are sold through: the first one that takes recurring payments and sells, or,
// with retired, the first one that takes recurring payments at all, which is
// the one that went on billing the subscriptions it sold. A plan's price is a
// price on that provider's account, so there is one such provider at a time.
func (s *Store) PlanProvider(held []ProviderConfig, retired bool) (ProviderConfig, paymentprovider.Subscriptions, bool) {
	for _, config := range held {
		if !config.Ready || (config.Retired && !retired) {
			continue
		}
		provider, ok := s.providers.Lookup(config.Provider)
		if !ok {
			continue
		}
		if subscriptions, ok := provider.(paymentprovider.Subscriptions); ok {
			return config, subscriptions, true
		}
	}
	return ProviderConfig{}, nil, false
}

// othersCharge refuses currency when a provider of rows, other than the ones
// except names, sells for the tenant and does not charge in it. A retired
// provider sells nothing more, so it holds the currency to nothing, and one
// this build does not register sells nothing either.
func (s *Store) othersCharge(rows []dbmodels.TenantPaymentProvider, currency string, except ...string) error {
	for _, row := range rows {
		if row.RetiredAt.Valid || slices.Contains(except, row.Provider) {
			continue
		}
		other, ok := s.providers.Lookup(row.Provider)
		if ok && !other.Declaration().Charges(currency) {
			return fmt.Errorf("%w: %s, which the tenant also sells through, does not charge in %q", ErrUnsupportedCurrency, row.Provider, currency)
		}
	}
	return nil
}

func (s *Store) providerConfig(row dbmodels.TenantPaymentProvider) (ProviderConfig, error) {
	stored, err := decodeStoredFields(row.CredentialsEncrypted, row.CredentialHints)
	if err != nil {
		return ProviderConfig{}, err
	}
	fields, ready := s.describe(row.Provider, row.Enabled, stored)
	return ProviderConfig{
		TenantID:  row.TenantID,
		Provider:  row.Provider,
		Enabled:   row.Enabled,
		Retired:   row.RetiredAt.Valid,
		Fields:    fields,
		Ready:     ready,
		CreatedAt: row.CreatedAt,
		UpdatedAt: row.UpdatedAt,
	}, nil
}

func (f storedFields) marshal() (json.RawMessage, json.RawMessage, error) {
	encrypted, err := json.Marshal(f.encrypted)
	if err != nil {
		return nil, nil, err
	}
	hints, err := json.Marshal(f.hints)
	if err != nil {
		return nil, nil, err
	}
	return encrypted, hints, nil
}
