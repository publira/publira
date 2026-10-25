package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/locale"
	"github.com/publira/publira/server/internal/paymentsettings"
	"github.com/publira/publira/server/internal/platformpolicy"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

const (
	// maxCoinNameRunes bounds the word that follows a number wherever a
	// balance or a price is shown. It counts code points, so a name costs the
	// same length in every script.
	maxCoinNameRunes = 30

	// The disclosures are shown where coins are sold, so they are bounded by
	// what such a page can carry. Each counts code points.
	maxCoinIssuerNameRunes = 200
	maxCoinContactRunes    = 500
	maxCoinNoticeRunes     = 2000

	// maxCoinTermsURLLength is in bytes, as a URL is stored.
	maxCoinTermsURLLength = 2048

	// maxCoinExpiryDays is the column's own bound, which keeps a grant's
	// expiry inside a timestamp.
	maxCoinExpiryDays = 36500
)

var (
	errCoinsNotAllowed   = errors.New("the platform does not allow tenants to issue coins")
	errCoinsCannotBeSold = errors.New("coins need a ready payment provider or a ready app store to sell packs through")
)

// coinName is one locale's name of the tenant's coin, as a save writes it.
type coinName struct {
	locale string
	name   string
}

// coinSettingsInput is the tenant's coin settings, read and checked from a
// request.
type coinSettingsInput struct {
	enabled        bool
	selling        bool
	coinUnitAmount int32
	expiryDays     int32
	issuerName     string
	termsURL       string
	contact        string
	notice         string
	names          []coinName
}

// readCoinSettingsInput checks the fields the settings are saved with, and,
// while they turn coins on, that every one coins need is there. Whether the
// platform and the tenant's payments let coins be turned on is for the caller
// to ask the database.
func readCoinSettingsInput(req *publiraadminv1.TenantCoinSettings, tenant dbmodels.Tenant) (coinSettingsInput, error) {
	if req == nil {
		return coinSettingsInput{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("settings is required"), "settings")
	}
	if req.CoinUnitAmount < 0 {
		return coinSettingsInput{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("coin_unit_amount must not be negative"), "settings.coin_unit_amount")
	}
	if req.ExpiryDays < 0 || req.ExpiryDays > maxCoinExpiryDays {
		return coinSettingsInput{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, fmt.Errorf("expiry_days must be between 0 and %d", maxCoinExpiryDays), "settings.expiry_days")
	}
	issuerName, err := readCoinText(req.IssuerName, maxCoinIssuerNameRunes, "settings.issuer_name")
	if err != nil {
		return coinSettingsInput{}, err
	}
	termsURL := strings.TrimSpace(req.TermsUrl)
	if err := validateCoinTermsURL(termsURL); err != nil {
		return coinSettingsInput{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "settings.terms_url")
	}
	contact, err := readCoinText(req.Contact, maxCoinContactRunes, "settings.contact")
	if err != nil {
		return coinSettingsInput{}, err
	}
	notice, err := readCoinText(req.Notice, maxCoinNoticeRunes, "settings.notice")
	if err != nil {
		return coinSettingsInput{}, err
	}
	names, err := readCoinNames(req.Names, tenant)
	if err != nil {
		return coinSettingsInput{}, err
	}
	input := coinSettingsInput{
		enabled:        req.Enabled,
		selling:        req.Selling,
		coinUnitAmount: req.CoinUnitAmount,
		expiryDays:     req.ExpiryDays,
		issuerName:     issuerName,
		termsURL:       termsURL,
		contact:        contact,
		notice:         notice,
		names:          names,
	}
	if input.enabled {
		if err := input.requireWhatCoinsNeed(tenant); err != nil {
			return coinSettingsInput{}, err
		}
	}
	return input, nil
}

// requireWhatCoinsNeed names the first field coins cannot be turned on
// without: what one is worth, how long it lasts, each disclosure, and a name
// in the tenant's default locale, the one a reader in any other locale falls
// back to.
func (in coinSettingsInput) requireWhatCoinsNeed(tenant dbmodels.Tenant) error {
	missing := func(field string) error {
		return rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, fmt.Errorf("%s is required while coins are enabled", field), "settings."+field)
	}
	switch {
	case in.coinUnitAmount == 0:
		return missing("coin_unit_amount")
	case in.expiryDays == 0:
		return missing("expiry_days")
	case in.issuerName == "":
		return missing("issuer_name")
	case in.termsURL == "":
		return missing("terms_url")
	case in.contact == "":
		return missing("contact")
	case in.notice == "":
		return missing("notice")
	}
	if !slices.ContainsFunc(in.names, func(n coinName) bool { return n.locale == tenant.DefaultLocale }) {
		return rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, fmt.Errorf("a name in the default locale %s is required while coins are enabled", tenant.DefaultLocale), "settings.names")
	}
	return nil
}

// readCoinText trims a disclosure and bounds its length.
func readCoinText(raw string, maxRunes int, field string) (string, error) {
	value := strings.TrimSpace(raw)
	if utf8.RuneCountInString(value) > maxRunes {
		return "", rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, fmt.Errorf("must be at most %d characters", maxRunes), field)
	}
	return value, nil
}

// validateCoinTermsURL accepts no URL, or an absolute http or https one a
// reader's browser can open.
func validateCoinTermsURL(raw string) error {
	if raw == "" {
		return nil
	}
	if len(raw) > maxCoinTermsURLLength {
		return fmt.Errorf("terms_url must be at most %d bytes", maxCoinTermsURLLength)
	}
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return errors.New("terms_url must be an absolute http or https URL")
	}
	return nil
}

// readCoinNames checks each locale's name: trimmed, not blank, at most
// maxCoinNameRunes, in a locale the tenant offers, and each locale once. A
// name in a language the site does not serve could be stored but never shown,
// so it is refused rather than kept out of sight, as a series title is.
func readCoinNames(raw []*publiraadminv1.CoinNameTranslation, tenant dbmodels.Tenant) ([]coinName, error) {
	names := make([]coinName, 0, len(raw))
	for i, entry := range raw {
		field := fmt.Sprintf("settings.names[%d]", i)
		code, err := locale.Normalize(entry.GetLocale())
		if err != nil || !slices.Contains(tenant.SupportedLocales, code) {
			return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("locale must be a locale the tenant offers"), field+".locale")
		}
		if slices.ContainsFunc(names, func(n coinName) bool { return n.locale == code }) {
			return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, fmt.Errorf("locale %s is named more than once", code), field+".locale")
		}
		name := strings.TrimSpace(entry.GetName())
		if name == "" {
			return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("name is required"), field+".name")
		}
		if utf8.RuneCountInString(name) > maxCoinNameRunes {
			return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, fmt.Errorf("name must be at most %d characters", maxCoinNameRunes), field+".name")
		}
		names = append(names, coinName{locale: code, name: name})
	}
	return names, nil
}

// coinSettingsUnchanged reports whether a save would store what is stored
// already, names included, in which case it is not a change the audit log has
// to answer for.
func coinSettingsUnchanged(current dbmodels.TenantCoinConfig, currentNames []dbmodels.TenantCoinNameTranslation, in coinSettingsInput) bool {
	if current.Enabled != in.enabled ||
		current.Selling != in.selling ||
		current.CoinUnitAmount.Int32 != in.coinUnitAmount ||
		current.ExpiryDays.Int32 != in.expiryDays ||
		current.IssuerName != in.issuerName ||
		current.TermsUrl != in.termsURL ||
		current.Contact != in.contact ||
		current.Notice != in.notice ||
		len(currentNames) != len(in.names) {
		return false
	}
	for _, stored := range currentNames {
		if !slices.Contains(in.names, coinName{locale: stored.Locale, name: stored.Name}) {
			return false
		}
	}
	return true
}

// requireCoinsCanBeTurnedOn refuses turning coins on while the platform does
// not allow tenant coins, and while the tenant has no way to sell a pack:
// neither its payment provider nor one of its app stores is ready.
func (s *adminServer) requireCoinsCanBeTurnedOn(txCtx context.Context, tenantID uuid.UUID) error {
	queries := s.queriesFor(txCtx)
	policy, _, err := platformpolicy.Read(txCtx, queries)
	if err != nil {
		return s.internalDBError(txCtx, "failed to read platform policy", err)
	}
	if !policy.TenantCoinsAllowed {
		return connect.NewError(connect.CodeFailedPrecondition, errCoinsNotAllowed.Error()).WithCause(errCoinsNotAllowed)
	}
	payments, err := s.paymentStore(txCtx).GetPublic(txCtx, tenantID)
	if err != nil {
		return s.internalDBError(txCtx, "failed to read payment settings for coins", err, "tenant_id", tenantID.String())
	}
	if payments.Ready {
		return nil
	}
	stores, err := paymentsettings.NewAppStores(queries, s.encryptor).Get(txCtx, tenantID)
	if err != nil {
		return s.internalDBError(txCtx, "failed to read store payment settings for coins", err, "tenant_id", tenantID.String())
	}
	if stores.AppStore.Ready || stores.GooglePlay.Ready {
		return nil
	}
	return connect.NewError(connect.CodeFailedPrecondition, errCoinsCannotBeSold.Error()).WithCause(errCoinsCannotBeSold)
}

// checkCoinAmountCurrency refuses an amount entered in a currency the tenant
// no longer sells in, and holds off a change of its currency until q's
// transaction ends, as checkPriceCurrency does for an episode's price. A zero
// amount is no amount of any currency, so it is not checked.
func (s *adminServer) checkCoinAmountCurrency(ctx context.Context, q paymentsettings.PriceCurrencyQuerier, tenantID uuid.UUID, amount int32, currency, field string) error {
	if amount == 0 {
		return nil
	}
	err := paymentsettings.CheckPriceCurrency(ctx, q, tenantID, currency)
	if errors.Is(err, paymentsettings.ErrPriceCurrencyChanged) {
		return rpcerrors.NewFieldViolationError(connect.CodeFailedPrecondition, err, field)
	}
	if err != nil {
		return s.internalDBError(ctx, "failed to check the currency of a coin amount", err, "tenant_id", tenantID.String())
	}
	return nil
}

// coinSettingsAnswer is what both coin settings RPCs answer with.
type coinSettingsAnswer struct {
	settings            *publiraadminv1.TenantCoinSettings
	platformAllowsCoins bool
	currency            string
}

// readCoinSettings reads the tenant's coin settings, the platform's allowance,
// and the tenant's currency on the querier ctx carries. A tenant that has
// saved nothing reads as the columns' defaults.
func (s *adminServer) readCoinSettings(ctx context.Context, tenantID uuid.UUID) (coinSettingsAnswer, error) {
	queries := s.queriesFor(ctx)
	config, err := queries.GetTenantCoinConfig(ctx, tenantID)
	if errors.Is(err, sql.ErrNoRows) {
		config = dbmodels.TenantCoinConfig{TenantID: tenantID}
	} else if err != nil {
		return coinSettingsAnswer{}, s.internalDBError(ctx, "failed to read coin settings", err, "tenant_id", tenantID.String())
	}
	names, err := queries.ListTenantCoinNames(ctx, tenantID)
	if err != nil {
		return coinSettingsAnswer{}, s.internalDBError(ctx, "failed to list coin names", err, "tenant_id", tenantID.String())
	}
	policy, _, err := platformpolicy.Read(ctx, queries)
	if err != nil {
		return coinSettingsAnswer{}, s.internalDBError(ctx, "failed to read platform policy", err)
	}
	currency, err := paymentsettings.TenantCurrency(ctx, queries, tenantID)
	if err != nil {
		return coinSettingsAnswer{}, s.internalDBError(ctx, "failed to read the tenant currency", err, "tenant_id", tenantID.String())
	}
	return coinSettingsAnswer{
		settings:            coinSettingsToProto(config, names),
		platformAllowsCoins: policy.TenantCoinsAllowed,
		currency:            currency,
	}, nil
}

func coinSettingsToProto(config dbmodels.TenantCoinConfig, names []dbmodels.TenantCoinNameTranslation) *publiraadminv1.TenantCoinSettings {
	translations := make([]*publiraadminv1.CoinNameTranslation, 0, len(names))
	for _, row := range names {
		translations = append(translations, &publiraadminv1.CoinNameTranslation{
			Locale:    row.Locale,
			Name:      row.Name,
			CreatedAt: row.CreatedAt.UTC().Format(time.RFC3339),
			UpdatedAt: row.UpdatedAt.UTC().Format(time.RFC3339),
		})
	}
	return &publiraadminv1.TenantCoinSettings{
		Enabled:        config.Enabled,
		Selling:        config.Selling,
		CoinUnitAmount: config.CoinUnitAmount.Int32,
		ExpiryDays:     config.ExpiryDays.Int32,
		IssuerName:     config.IssuerName,
		TermsUrl:       config.TermsUrl,
		Contact:        config.Contact,
		Notice:         config.Notice,
		Names:          translations,
	}
}

// nullablePositive stores zero, the request's "not stated", as NULL.
func nullablePositive(value int32) sql.NullInt32 {
	return sql.NullInt32{Int32: value, Valid: value > 0}
}

func (s *adminServer) GetTenantCoinSettings(
	ctx context.Context,
	req *publiraadminv1.GetTenantCoinSettingsRequest,
) (*publiraadminv1.GetTenantCoinSettingsResponse, error) {
	if _, err := s.requireTenantAuditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	answer, err := s.readCoinSettings(ctx, tenant.ID)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.GetTenantCoinSettingsResponse{
		Settings:            answer.settings,
		PlatformAllowsCoins: answer.platformAllowsCoins,
		Currency:            answer.currency,
	}, nil
}

func (s *adminServer) UpdateTenantCoinSettings(
	ctx context.Context,
	req *publiraadminv1.UpdateTenantCoinSettingsRequest,
) (*publiraadminv1.UpdateTenantCoinSettingsResponse, error) {
	session, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	input, err := readCoinSettingsInput(req.Settings, tenant)
	if err != nil {
		return nil, err
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin update coin settings transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	txCtx := rpcmiddleware.WithTenantQueries(ctx, dbmodels.New(tx))
	queries := s.queriesFor(txCtx)

	if err := s.checkCoinAmountCurrency(txCtx, queries, tenant.ID, input.coinUnitAmount, req.Currency, "currency"); err != nil {
		return nil, err
	}
	if err := queries.EnsureTenantCoinConfig(txCtx, tenant.ID); err != nil {
		return nil, s.internalDBError(ctx, "failed to create coin settings", err, "tenant_id", tenant.ID.String())
	}
	current, err := queries.LockTenantCoinConfig(txCtx, tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to lock coin settings", err, "tenant_id", tenant.ID.String())
	}
	// Only turning coins on asks the platform and the payments: a tenant whose
	// coins are on already keeps saving them, to stop selling among other
	// things, whatever has changed around it since.
	if input.enabled && !current.Enabled {
		if err := s.requireCoinsCanBeTurnedOn(txCtx, tenant.ID); err != nil {
			return nil, err
		}
	}
	currentNames, err := queries.ListTenantCoinNames(txCtx, tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list coin names", err, "tenant_id", tenant.ID.String())
	}

	if !coinSettingsUnchanged(current, currentNames, input) {
		if _, err := queries.UpdateTenantCoinConfig(txCtx, dbmodels.UpdateTenantCoinConfigParams{
			TenantID:       tenant.ID,
			Enabled:        input.enabled,
			Selling:        input.selling,
			CoinUnitAmount: nullablePositive(input.coinUnitAmount),
			ExpiryDays:     nullablePositive(input.expiryDays),
			IssuerName:     input.issuerName,
			TermsUrl:       input.termsURL,
			Contact:        input.contact,
			Notice:         input.notice,
		}); err != nil {
			return nil, s.internalDBError(ctx, "failed to update coin settings", err, "tenant_id", tenant.ID.String())
		}
		locales := make([]string, 0, len(input.names))
		for _, name := range input.names {
			id, err := uuid.NewV7()
			if err != nil {
				return nil, connect.NewError(connect.CodeInternal, err.Error()).WithCause(err)
			}
			if err := queries.UpsertTenantCoinName(txCtx, dbmodels.UpsertTenantCoinNameParams{
				ID:       id,
				TenantID: tenant.ID,
				Locale:   name.locale,
				Name:     name.name,
			}); err != nil {
				return nil, s.internalDBError(ctx, "failed to write a coin name", err, "tenant_id", tenant.ID.String(), "locale", name.locale)
			}
			locales = append(locales, name.locale)
		}
		if err := queries.DeleteTenantCoinNamesExcept(txCtx, dbmodels.DeleteTenantCoinNamesExceptParams{TenantID: tenant.ID, Locales: locales}); err != nil {
			return nil, s.internalDBError(ctx, "failed to remove coin names", err, "tenant_id", tenant.ID.String())
		}
		if err := s.writeTenantSettingAudit(txCtx, tenant, session, "coin_settings_updated", "coin_settings"); err != nil {
			return nil, err
		}
	}

	answer, err := s.readCoinSettings(txCtx, tenant.ID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit coin settings", err, "tenant_id", tenant.ID.String())
	}
	return &publiraadminv1.UpdateTenantCoinSettingsResponse{
		Settings:            answer.settings,
		PlatformAllowsCoins: answer.platformAllowsCoins,
		Currency:            answer.currency,
	}, nil
}
