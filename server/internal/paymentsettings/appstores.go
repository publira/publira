package paymentsettings

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rsa"
	"crypto/x509"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

const (
	// RouteExternalCheckout and RouteStore are the values
	// tenant_config.app_purchase_route takes.
	RouteExternalCheckout = "external_checkout"
	RouteStore            = "store"
)

var (
	ErrInvalidAppPurchaseRoute       = errors.New("app purchase route must be external_checkout or store")
	ErrUnresolvedAppPurchaseRoute    = errors.New("stored app purchase route is not a supported value")
	ErrStoreRouteRequiresReadyStore  = errors.New("selling through the store requires an enabled store with its key and its app")
	ErrInvalidIssuerID               = errors.New("issuer ID must be a UUID")
	ErrInvalidKeyID                  = errors.New("key ID must be ten capital letters and digits")
	ErrInvalidAppStorePrivateKey     = errors.New("private key must be a PKCS #8 P-256 key in PEM form")
	ErrAppStoreCredentialsRequired   = errors.New("issuer ID, key ID, and private key are required when the App Store is enabled")
	ErrInvalidServiceAccountKey      = errors.New("service account key must be the JSON key file of a service account")
	ErrGooglePlayCredentialsRequired = errors.New("a service account key is required when Google Play is enabled")
)

var keyIDPattern = regexp.MustCompile(`^[A-Z0-9]{10}$`)

// AppStoresQuerier is the persistence surface [AppStores] uses. Like
// [PaymentQuerier], its reads return ciphertext.
type AppStoresQuerier interface {
	GetTenantConfigByTenantID(ctx context.Context, tenantID uuid.UUID) (dbmodels.TenantConfig, error)
	LockTenantConfigByTenantID(ctx context.Context, tenantID uuid.UUID) (dbmodels.TenantConfig, error)
	GetTenantAppStoreConfigByTenantID(ctx context.Context, tenantID uuid.UUID) (dbmodels.TenantAppStoreConfig, error)
	GetTenantGooglePlayConfigByTenantID(ctx context.Context, tenantID uuid.UUID) (dbmodels.TenantGooglePlayConfig, error)
	UpsertTenantAppStoreConfig(ctx context.Context, arg dbmodels.UpsertTenantAppStoreConfigParams) (dbmodels.TenantAppStoreConfig, error)
	UpsertTenantGooglePlayConfig(ctx context.Context, arg dbmodels.UpsertTenantGooglePlayConfigParams) (dbmodels.TenantGooglePlayConfig, error)
	UpsertTenantAppPurchaseRoute(ctx context.Context, arg dbmodels.UpsertTenantAppPurchaseRouteParams) (string, error)
}

// AppStoreConfig is the non-secret view of a tenant's App Store Connect API
// key. BundleIdentifier comes from the tenant's iOS app association.
type AppStoreConfig struct {
	Enabled              bool
	IssuerID             string
	KeyID                string
	PrivateKeyConfigured bool
	PrivateKeyHint       string
	BundleIdentifier     string
	Ready                bool
}

// GooglePlayConfig is the non-secret view of a tenant's Google Play service
// account. PackageName comes from the tenant's Android app association.
type GooglePlayConfig struct {
	Enabled                     bool
	ServiceAccountEmail         string
	ServiceAccountKeyConfigured bool
	ServiceAccountKeyHint       string
	PackageName                 string
	Ready                       bool
}

// StoreConfig is how a tenant's app sells, and the two stores it may sell
// through. It is safe to return from APIs and to log.
type StoreConfig struct {
	Route      string
	AppStore   AppStoreConfig
	GooglePlay GooglePlayConfig
}

type AppStoreUpdate struct {
	Enabled              bool
	IssuerID             string
	KeyID                string
	PrivateKey           string
	PrivateKeyUpdateMode int32
}

type GooglePlayUpdate struct {
	Enabled                     bool
	ServiceAccountKey           string
	ServiceAccountKeyUpdateMode int32
}

type StoreUpdateInput struct {
	Route      string
	AppStore   AppStoreUpdate
	GooglePlay GooglePlayUpdate
}

// AppStores stores the App Store and Google Play credentials and the app
// purchase route. Its writes span three tables, so the caller hands it the
// querier of a transaction and records the audit event once that commits.
// [AppStores.Update] and [AppStores.RequireReadyStoreForRoute] lock the
// tenant_config row first, so they serialize against each other.
type AppStores struct {
	queries   AppStoresQuerier
	encryptor SecretManager
}

func NewAppStores(queries AppStoresQuerier, encryptor SecretManager) *AppStores {
	return &AppStores{queries: queries, encryptor: encryptor}
}

// ResolveAppPurchaseRoute checks a stored route. A value naming no route is
// reported rather than read as the default, which would sell through a route
// the tenant did not choose.
func ResolveAppPurchaseRoute(stored string) (string, error) {
	switch stored {
	case RouteExternalCheckout, RouteStore:
		return stored, nil
	default:
		return "", fmt.Errorf("%w: %q", ErrUnresolvedAppPurchaseRoute, stored)
	}
}

// Get returns the non-secret view. A tenant that has saved nothing sells
// through the external checkout and has neither store configured.
func (a *AppStores) Get(ctx context.Context, tenantID uuid.UUID) (StoreConfig, error) {
	current, err := a.load(ctx, tenantID, a.queries.GetTenantConfigByTenantID)
	if err != nil {
		return StoreConfig{}, err
	}
	route, err := ResolveAppPurchaseRoute(current.route)
	if err != nil {
		return StoreConfig{}, err
	}
	return StoreConfig{
		Route:      route,
		AppStore:   appStoreConfigFromRow(current.appStore, current.bundleIdentifier),
		GooglePlay: googlePlayConfigFromRow(current.googlePlay, current.packageName),
	}, nil
}

// Update writes both stores and the route. Every field of input is written;
// a key is kept, replaced, or cleared as its update mode says.
func (a *AppStores) Update(ctx context.Context, tenantID uuid.UUID, input StoreUpdateInput) (StoreConfig, error) {
	if input.Route != RouteExternalCheckout && input.Route != RouteStore {
		return StoreConfig{}, ErrInvalidAppPurchaseRoute
	}
	current, err := a.load(ctx, tenantID, a.queries.LockTenantConfigByTenantID)
	if err != nil {
		return StoreConfig{}, err
	}

	appStoreParams, err := a.appStoreParams(tenantID, current.appStore, input.AppStore)
	if err != nil {
		return StoreConfig{}, err
	}
	googlePlayParams, err := a.googlePlayParams(tenantID, current.googlePlay, input.GooglePlay)
	if err != nil {
		return StoreConfig{}, err
	}

	if input.Route == RouteStore {
		appStoreReady := appStoreParams.Enabled && current.bundleIdentifier != ""
		googlePlayReady := googlePlayParams.Enabled && current.packageName != ""
		if !appStoreReady && !googlePlayReady {
			return StoreConfig{}, ErrStoreRouteRequiresReadyStore
		}
	}

	appStoreRow, err := a.queries.UpsertTenantAppStoreConfig(ctx, appStoreParams)
	if err != nil {
		return StoreConfig{}, err
	}
	googlePlayRow, err := a.queries.UpsertTenantGooglePlayConfig(ctx, googlePlayParams)
	if err != nil {
		return StoreConfig{}, err
	}
	route, err := a.queries.UpsertTenantAppPurchaseRoute(ctx, dbmodels.UpsertTenantAppPurchaseRouteParams{
		TenantID:         tenantID,
		AppPurchaseRoute: input.Route,
	})
	if err != nil {
		return StoreConfig{}, err
	}

	return StoreConfig{
		Route:      route,
		AppStore:   appStoreConfigFromRow(appStoreRow, current.bundleIdentifier),
		GooglePlay: googlePlayConfigFromRow(googlePlayRow, current.packageName),
	}, nil
}

// RequireReadyStoreForRoute answers [ErrStoreRouteRequiresReadyStore] when the
// tenant sells through the store and no store can sell. A write to what a
// store's readiness depends on calls it inside its transaction, after locking
// the tenant_config row.
func (a *AppStores) RequireReadyStoreForRoute(ctx context.Context, tenantID uuid.UUID) error {
	cfg, err := a.Get(ctx, tenantID)
	if err != nil {
		return err
	}
	if cfg.Route == RouteStore && !cfg.AppStore.Ready && !cfg.GooglePlay.Ready {
		return ErrStoreRouteRequiresReadyStore
	}
	return nil
}

func (a *AppStores) appStoreParams(tenantID uuid.UUID, existing dbmodels.TenantAppStoreConfig, update AppStoreUpdate) (dbmodels.UpsertTenantAppStoreConfigParams, error) {
	issuerID, err := normalizeIssuerID(update.IssuerID)
	if err != nil {
		return dbmodels.UpsertTenantAppStoreConfigParams{}, err
	}
	keyID, err := normalizeKeyID(update.KeyID)
	if err != nil {
		return dbmodels.UpsertTenantAppStoreConfigParams{}, err
	}
	if update.PrivateKeyUpdateMode == SecretUpdateModeReplace && strings.TrimSpace(update.PrivateKey) != "" {
		if err := validateAppStorePrivateKey(update.PrivateKey); err != nil {
			return dbmodels.UpsertTenantAppStoreConfigParams{}, err
		}
	}
	encrypted, hint, err := applySecretUpdate(
		nullStringValue(existing.PrivateKeyEncrypted),
		nullStringValue(existing.PrivateKeyHint),
		update.PrivateKeyUpdateMode,
		update.PrivateKey,
		a.encryptor,
	)
	if err != nil {
		return dbmodels.UpsertTenantAppStoreConfigParams{}, err
	}
	if update.PrivateKeyUpdateMode == SecretUpdateModeReplace {
		hint = MaskSecret(pemBody(update.PrivateKey))
	}
	if update.Enabled && (issuerID == "" || keyID == "" || encrypted == "") {
		return dbmodels.UpsertTenantAppStoreConfigParams{}, ErrAppStoreCredentialsRequired
	}
	return dbmodels.UpsertTenantAppStoreConfigParams{
		TenantID:            tenantID,
		Enabled:             update.Enabled,
		IssuerID:            nullableString(issuerID),
		KeyID:               nullableString(keyID),
		PrivateKeyEncrypted: nullableString(encrypted),
		PrivateKeyHint:      nullableString(hint),
	}, nil
}

func (a *AppStores) googlePlayParams(tenantID uuid.UUID, existing dbmodels.TenantGooglePlayConfig, update GooglePlayUpdate) (dbmodels.UpsertTenantGooglePlayConfigParams, error) {
	var key serviceAccountKey
	if update.ServiceAccountKeyUpdateMode == SecretUpdateModeReplace && strings.TrimSpace(update.ServiceAccountKey) != "" {
		parsed, err := parseServiceAccountKey(update.ServiceAccountKey)
		if err != nil {
			return dbmodels.UpsertTenantGooglePlayConfigParams{}, err
		}
		key = parsed
	}
	encrypted, hint, err := applySecretUpdate(
		nullStringValue(existing.ServiceAccountKeyEncrypted),
		nullStringValue(existing.ServiceAccountKeyHint),
		update.ServiceAccountKeyUpdateMode,
		update.ServiceAccountKey,
		a.encryptor,
	)
	if err != nil {
		return dbmodels.UpsertTenantGooglePlayConfigParams{}, err
	}
	// The email follows the key: kept with it, taken from a replacing one, and
	// gone with a cleared one.
	email := nullStringValue(existing.ServiceAccountEmail)
	switch update.ServiceAccountKeyUpdateMode {
	case SecretUpdateModeReplace:
		email = key.ClientEmail
		hint = MaskSecret(key.PrivateKeyID)
	case SecretUpdateModeClear:
		email = ""
	}
	if update.Enabled && encrypted == "" {
		return dbmodels.UpsertTenantGooglePlayConfigParams{}, ErrGooglePlayCredentialsRequired
	}
	return dbmodels.UpsertTenantGooglePlayConfigParams{
		TenantID:                   tenantID,
		Enabled:                    update.Enabled,
		ServiceAccountEmail:        nullableString(email),
		ServiceAccountKeyEncrypted: nullableString(encrypted),
		ServiceAccountKeyHint:      nullableString(hint),
	}, nil
}

type storeRows struct {
	route            string
	bundleIdentifier string
	packageName      string
	appStore         dbmodels.TenantAppStoreConfig
	googlePlay       dbmodels.TenantGooglePlayConfig
}

func (a *AppStores) load(
	ctx context.Context,
	tenantID uuid.UUID,
	readConfig func(context.Context, uuid.UUID) (dbmodels.TenantConfig, error),
) (storeRows, error) {
	rows := storeRows{route: RouteExternalCheckout}
	config, err := readConfig(ctx, tenantID)
	switch {
	case err == nil:
		rows.route = config.AppPurchaseRoute
		rows.bundleIdentifier = nullStringValue(config.IosBundleIdentifier)
		rows.packageName = nullStringValue(config.AndroidApplicationID)
	case !errors.Is(err, sql.ErrNoRows):
		return storeRows{}, err
	}
	rows.appStore, err = a.queries.GetTenantAppStoreConfigByTenantID(ctx, tenantID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return storeRows{}, err
	}
	rows.googlePlay, err = a.queries.GetTenantGooglePlayConfigByTenantID(ctx, tenantID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return storeRows{}, err
	}
	return rows, nil
}

func appStoreConfigFromRow(row dbmodels.TenantAppStoreConfig, bundleIdentifier string) AppStoreConfig {
	keyConfigured := strings.TrimSpace(nullStringValue(row.PrivateKeyEncrypted)) != ""
	return AppStoreConfig{
		Enabled:              row.Enabled,
		IssuerID:             nullStringValue(row.IssuerID),
		KeyID:                nullStringValue(row.KeyID),
		PrivateKeyConfigured: keyConfigured,
		PrivateKeyHint:       nullStringValue(row.PrivateKeyHint),
		BundleIdentifier:     bundleIdentifier,
		Ready:                row.Enabled && keyConfigured && bundleIdentifier != "",
	}
}

func googlePlayConfigFromRow(row dbmodels.TenantGooglePlayConfig, packageName string) GooglePlayConfig {
	keyConfigured := strings.TrimSpace(nullStringValue(row.ServiceAccountKeyEncrypted)) != ""
	return GooglePlayConfig{
		Enabled:                     row.Enabled,
		ServiceAccountEmail:         nullStringValue(row.ServiceAccountEmail),
		ServiceAccountKeyConfigured: keyConfigured,
		ServiceAccountKeyHint:       nullStringValue(row.ServiceAccountKeyHint),
		PackageName:                 packageName,
		Ready:                       row.Enabled && keyConfigured && packageName != "",
	}
}

func normalizeIssuerID(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", nil
	}
	parsed, err := uuid.Parse(value)
	if err != nil || len(value) != 36 {
		return "", ErrInvalidIssuerID
	}
	return parsed.String(), nil
}

func normalizeKeyID(value string) (string, error) {
	value = strings.ToUpper(strings.TrimSpace(value))
	if value == "" {
		return "", nil
	}
	if !keyIDPattern.MatchString(value) {
		return "", ErrInvalidKeyID
	}
	return value, nil
}

// validateAppStorePrivateKey accepts what App Store Connect issues: an EC key
// on P-256 in a PKCS #8 "PRIVATE KEY" block.
func validateAppStorePrivateKey(value string) error {
	block, _ := pem.Decode([]byte(strings.TrimSpace(value)))
	if block == nil || block.Type != "PRIVATE KEY" {
		return ErrInvalidAppStorePrivateKey
	}
	key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return ErrInvalidAppStorePrivateKey
	}
	ecKey, ok := key.(*ecdsa.PrivateKey)
	if !ok || ecKey.Curve != elliptic.P256() {
		return ErrInvalidAppStorePrivateKey
	}
	return nil
}

// pemBody is the base64 of a PEM block with the armor and line breaks taken
// away, so a hint of a .p8 file shows key material rather than its END line.
func pemBody(value string) string {
	block, _ := pem.Decode([]byte(strings.TrimSpace(value)))
	if block == nil {
		return ""
	}
	return base64.StdEncoding.EncodeToString(block.Bytes)
}

type serviceAccountKey struct {
	Type         string `json:"type"`
	ClientEmail  string `json:"client_email"`
	PrivateKeyID string `json:"private_key_id"`
	PrivateKey   string `json:"private_key"`
}

func parseServiceAccountKey(value string) (serviceAccountKey, error) {
	var key serviceAccountKey
	if err := json.Unmarshal([]byte(strings.TrimSpace(value)), &key); err != nil {
		return serviceAccountKey{}, ErrInvalidServiceAccountKey
	}
	key.ClientEmail = strings.TrimSpace(key.ClientEmail)
	key.PrivateKeyID = strings.TrimSpace(key.PrivateKeyID)
	if key.Type != "service_account" || key.ClientEmail == "" || key.PrivateKeyID == "" {
		return serviceAccountKey{}, ErrInvalidServiceAccountKey
	}
	block, _ := pem.Decode([]byte(key.PrivateKey))
	if block == nil || block.Type != "PRIVATE KEY" {
		return serviceAccountKey{}, ErrInvalidServiceAccountKey
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return serviceAccountKey{}, ErrInvalidServiceAccountKey
	}
	if _, ok := parsed.(*rsa.PrivateKey); !ok {
		return serviceAccountKey{}, ErrInvalidServiceAccountKey
	}
	return key, nil
}
