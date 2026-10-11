package platformconfig

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/google/uuid"
	"golang.org/x/text/currency"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/dberr"
	"github.com/publira/publira/server/internal/fielderr"
	"github.com/publira/publira/server/internal/locale"
	"github.com/publira/publira/server/internal/tenanttz"
)

// The fields a refusal names, spelled as UpdatePlatformSettingsRequest spells
// them so the Connect adapter can report them as they are.
const (
	FieldDefaultTimezone  = "default_timezone"
	FieldDefaultLocale    = "default_locale"
	FieldDefaultCurrency  = "default_currency"
	FieldExpectedRevision = "expected_revision"
)

var (
	// ErrConflict refuses a save based on a revision the stored row has moved
	// past. The caller re-reads and decides again rather than having its half
	// of the row written over the half it never saw.
	ErrConflict = errors.New("platform settings have changed since they were read")

	// ErrDefaultCurrencyLocked refuses to change the default currency while a
	// tenant that sells in it has a purchase: that tenant's prices and the
	// amounts it recorded are amounts in the stored one.
	ErrDefaultCurrencyLocked = errors.New("the default currency cannot change while a tenant that sells in it has a purchase")

	errNegativeRevision = errors.New("expected_revision must not be negative")
	errInvalidCurrency  = errors.New("default_currency must be an ISO 4217 currency code")
)

// SaveParams replaces the platform default time zone, locale, and currency.
type SaveParams struct {
	DefaultTimezone string
	DefaultLocale   string
	// DefaultCurrency is the ISO 4217 code of the currency every tenant that
	// has saved no payment settings sells in. Empty keeps the stored one, which
	// is [DefaultCurrency] before any is saved.
	DefaultCurrency string
	// ExpectedRevision is the revision the settings were read at, 0 when none
	// were saved. Nil saves over whatever is stored, for a caller that read
	// nothing.
	ExpectedRevision *int64
}

// SiteRevalidator records on q, inside the transaction of a save, that the
// site cache entry of tenantID is owed a drop. Every caller passes
// [revalidate.RecordSiteDrop]; it is handed in rather than imported because
// the outbox that function writes to reads this package's defaults.
type SiteRevalidator func(ctx context.Context, q *dbmodels.Queries, tenantID uuid.UUID) error

// Validate normalizes p, or refuses it with a [*fielderr.Invalid], without
// reading anything.
func (p SaveParams) Validate() (SaveParams, error) {
	timezone, err := tenanttz.Normalize(p.DefaultTimezone)
	if err != nil {
		return SaveParams{}, &fielderr.Invalid{Field: FieldDefaultTimezone, Err: err}
	}
	defaultLocale, err := locale.Normalize(p.DefaultLocale)
	if err != nil {
		return SaveParams{}, &fielderr.Invalid{Field: FieldDefaultLocale, Err: err}
	}
	defaultCurrency, err := normalizeCurrency(p.DefaultCurrency)
	if err != nil {
		return SaveParams{}, &fielderr.Invalid{Field: FieldDefaultCurrency, Err: err}
	}
	if p.ExpectedRevision != nil && *p.ExpectedRevision < 0 {
		return SaveParams{}, &fielderr.Invalid{Field: FieldExpectedRevision, Err: errNegativeRevision}
	}
	return SaveParams{DefaultTimezone: timezone, DefaultLocale: defaultLocale, DefaultCurrency: defaultCurrency, ExpectedRevision: p.ExpectedRevision}, nil
}

// InitialParams are the platform defaults initial setup asks the first
// operator for. The time zone is not among them: a platform that has saved none
// starts on [tenanttz.Default], and one whose settings outlived its operators
// keeps the stored one.
type InitialParams struct {
	DefaultLocale string
	// DefaultCurrency is read as [SaveParams.DefaultCurrency] is: empty keeps
	// the stored one, which is [DefaultCurrency] before any is saved.
	DefaultCurrency string
}

// Validate normalizes p, or refuses it with a [*fielderr.Invalid], without
// reading anything.
func (p InitialParams) Validate() (InitialParams, error) {
	defaultLocale, err := locale.Normalize(p.DefaultLocale)
	if err != nil {
		return InitialParams{}, &fielderr.Invalid{Field: FieldDefaultLocale, Err: err}
	}
	defaultCurrency, err := normalizeCurrency(p.DefaultCurrency)
	if err != nil {
		return InitialParams{}, &fielderr.Invalid{Field: FieldDefaultCurrency, Err: err}
	}
	return InitialParams{DefaultLocale: defaultLocale, DefaultCurrency: defaultCurrency}, nil
}

// SaveInitial writes p on q, inside the transaction that creates the first
// operator, so that a platform that has an operator always has a language to
// render in. It saves as [Save] does, refusing a currency change with
// [ErrDefaultCurrencyLocked] and recording the drops it owes with
// revalidateSite, but files no platform audit entry: the platform_initial_setup
// event of the caller reports the setup as a whole.
func SaveInitial(ctx context.Context, q *dbmodels.Queries, p InitialParams, revalidateSite SiteRevalidator) (dbmodels.PlatformConfig, error) {
	p, err := p.Validate()
	if err != nil {
		return dbmodels.PlatformConfig{}, err
	}
	saved, _, err := write(ctx, q, SaveParams{DefaultLocale: p.DefaultLocale, DefaultCurrency: p.DefaultCurrency}, revalidateSite)
	return saved, err
}

// normalizeCurrency answers the ISO 4217 code value names, upper-cased, or
// empty for a blank. Three letters are not enough: a code no currency has is
// one no price can be charged in, and once a tenant that inherits it has sold,
// [ErrDefaultCurrencyLocked] keeps the typo from being corrected.
func normalizeCurrency(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", nil
	}
	if len(value) != 3 {
		return "", errInvalidCurrency
	}
	if code := strings.ToUpper(value); codesMissingFromParseISO[code] {
		return code, nil
	}
	unit, err := currency.ParseISO(value)
	if err != nil {
		return "", errInvalidCurrency
	}
	return unit.String(), nil
}

// codesMissingFromParseISO are the current ISO 4217 codes [currency.ParseISO]
// refuses. Its table is derived from CLDR 32, which predates them, while the
// Platform Console offers the currencies of the runtime's ICU data, which
// carries most of them: without this set a currency the console lists would be
// one the server refuses to save.
var codesMissingFromParseISO = map[string]bool{
	"MRU": true, // Mauritanian ouguiya
	"SLE": true, // Sierra Leonean leone
	"UYW": true, // Uruguayan unidad previsional
	"VED": true, // Venezuelan bolívar digital
	"VES": true, // Venezuelan bolívar soberano
	"XCG": true, // Caribbean guilder
	"ZWG": true, // Zimbabwe Gold
}

// Saved is the settings row a save leaves stored.
type Saved struct {
	dbmodels.PlatformConfig
	// CurrencyLocked reports whether a save that changes DefaultCurrency is
	// refused with [ErrDefaultCurrencyLocked]. It is read inside the save's
	// transaction, so a save that commits always has it to answer.
	CurrencyLocked bool
}

// Save writes p in one transaction on db, with its entry filed under actor.
// The row is locked first, so the revision it compares against cannot change
// between the comparison and the write. A save that changes no stored value
// writes nothing and files nothing. A save that changes the default currency
// records with revalidateSite a drop for each tenant that sells in it.
func Save(ctx context.Context, db *sql.DB, logger *slog.Logger, actor auditlog.PlatformActor, p SaveParams, revalidateSite SiteRevalidator) (Saved, error) {
	p, err := p.Validate()
	if err != nil {
		return Saved{}, err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return Saved{}, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	q := dbmodels.New(tx)
	config, changed, err := write(ctx, q, p, revalidateSite)
	if err != nil {
		return Saved{}, err
	}
	locked, err := CurrencyLocked(ctx, q)
	if err != nil {
		return Saved{}, err
	}
	saved := Saved{PlatformConfig: config, CurrencyLocked: locked}
	if !changed {
		return saved, nil
	}
	if err := auditlog.WritePlatform(ctx, q, logger, actor.Entry(auditlog.PlatformEntry{
		Action:     "platform_settings_updated",
		TargetType: "platform_config",
		TargetID:   "platform",
		Outcome:    auditlog.OutcomeSuccess,
	})); err != nil {
		return Saved{}, fmt.Errorf("audit platform_settings_updated: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return Saved{}, fmt.Errorf("commit: %w", err)
	}
	return saved, nil
}

// write saves p over the locked settings row on q, reporting whether it changed
// anything. An empty DefaultTimezone or DefaultCurrency keeps the stored one,
// or the constant before any is saved; [SaveParams.Validate] lets only the
// currency through empty, and [SaveInitial] leaves the time zone so.
func write(ctx context.Context, q *dbmodels.Queries, p SaveParams, revalidateSite SiteRevalidator) (dbmodels.PlatformConfig, bool, error) {
	current, err := q.LockPlatformConfig(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		// Any revision but zero was read from a row that has since been
		// deleted, and creating one would resurrect values nobody confirmed.
		if p.ExpectedRevision != nil && *p.ExpectedRevision != 0 {
			return dbmodels.PlatformConfig{}, false, ErrConflict
		}
		defaultTimezone, defaultCurrency := p.DefaultTimezone, p.DefaultCurrency
		if defaultTimezone == "" {
			defaultTimezone = tenanttz.Default
		}
		if defaultCurrency == "" {
			defaultCurrency = DefaultCurrency
		}
		if err := prepareCurrencyChange(ctx, q, DefaultCurrency, defaultCurrency, revalidateSite); err != nil {
			return dbmodels.PlatformConfig{}, false, err
		}
		inserted, err := q.InsertPlatformSettings(ctx, dbmodels.InsertPlatformSettingsParams{
			DefaultTimezone: defaultTimezone,
			DefaultLocale:   p.DefaultLocale,
			DefaultCurrency: defaultCurrency,
		})
		// Two first saves both find nothing to lock; the primary key settles
		// which one wins.
		if dberr.IsUniqueViolation(err) {
			return dbmodels.PlatformConfig{}, false, ErrConflict
		}
		if err != nil {
			return dbmodels.PlatformConfig{}, false, fmt.Errorf("insert platform settings: %w", err)
		}
		return inserted, true, nil
	}
	if err != nil {
		return dbmodels.PlatformConfig{}, false, fmt.Errorf("lock platform settings: %w", err)
	}
	if p.ExpectedRevision != nil && *p.ExpectedRevision != current.Revision {
		return dbmodels.PlatformConfig{}, false, ErrConflict
	}
	if p.DefaultTimezone == "" {
		p.DefaultTimezone = current.DefaultTimezone
	}
	if p.DefaultCurrency == "" {
		p.DefaultCurrency = current.DefaultCurrency
	}
	if current.DefaultTimezone == p.DefaultTimezone && current.DefaultLocale == p.DefaultLocale && current.DefaultCurrency == p.DefaultCurrency {
		return current, false, nil
	}
	if err := prepareCurrencyChange(ctx, q, current.DefaultCurrency, p.DefaultCurrency, revalidateSite); err != nil {
		return dbmodels.PlatformConfig{}, false, err
	}
	updated, err := q.UpdatePlatformSettings(ctx, dbmodels.UpdatePlatformSettingsParams{
		DefaultTimezone: p.DefaultTimezone,
		DefaultLocale:   p.DefaultLocale,
		DefaultCurrency: p.DefaultCurrency,
	})
	if err != nil {
		return dbmodels.PlatformConfig{}, false, fmt.Errorf("update platform settings: %w", err)
	}
	return updated, true, nil
}

// prepareCurrencyChange answers [ErrDefaultCurrencyLocked] for a change from
// current to next while a tenant that sells in the default currency has a
// purchase.
//
// A change it lets through owes every tenant that sells in the default
// currency a drop of its site cache entry, recorded with revalidateSite so
// that it commits with the change: the web apps cache the tenant's currency
// with the rest of its public settings, and until the entry goes they show
// and read its prices as amounts in the currency it no longer sells in.
func prepareCurrencyChange(ctx context.Context, q *dbmodels.Queries, current, next string, revalidateSite SiteRevalidator) error {
	if current == next {
		return nil
	}
	locked, err := CurrencyLocked(ctx, q)
	if err != nil {
		return err
	}
	if locked {
		return fmt.Errorf("%w: %s is stored", ErrDefaultCurrencyLocked, current)
	}
	tenantIDs, err := q.ListTenantIDsInDefaultCurrency(ctx)
	if err != nil {
		return fmt.Errorf("list tenants in the default currency: %w", err)
	}
	for _, tenantID := range tenantIDs {
		// As a save of the tenant's own currency does, so that a price checked
		// against the default it sells in cannot commit after this reads it.
		if err := q.LockTenantCurrency(ctx, tenantID); err != nil {
			return fmt.Errorf("hold the currency of tenant %s: %w", tenantID, err)
		}
		if err := revalidateSite(ctx, q, tenantID); err != nil {
			return fmt.Errorf("record the site revalidation of tenant %s: %w", tenantID, err)
		}
	}
	return nil
}

// CurrencyLockQuerier reads whether the default currency can still change.
type CurrencyLockQuerier interface {
	PlatformCurrencyHasSales(ctx context.Context) (bool, error)
}

// CurrencyLocked reports whether a save that changes the default currency is
// refused with [ErrDefaultCurrencyLocked], so a screen can say so before it
// offers the change.
func CurrencyLocked(ctx context.Context, q CurrencyLockQuerier) (bool, error) {
	locked, err := q.PlatformCurrencyHasSales(ctx)
	if err != nil {
		return false, fmt.Errorf("check sales in the default currency: %w", err)
	}
	return locked, nil
}

// Get reads the settings row, reporting whether one is saved.
func Get(ctx context.Context, q Querier) (dbmodels.PlatformConfig, bool, error) {
	config, err := q.GetPlatformConfig(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return dbmodels.PlatformConfig{}, false, nil
	}
	if err != nil {
		return dbmodels.PlatformConfig{}, false, fmt.Errorf("read platform config: %w", err)
	}
	return config, true, nil
}
