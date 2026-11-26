package paymentsettings_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/paymentprovider/payjp"
	"github.com/publira/publira/server/internal/paymentprovider/stripe"
	"github.com/publira/publira/server/internal/paymentsettings"
	"github.com/publira/publira/server/internal/secrethint"
	"github.com/publira/publira/server/internal/secretupdate"
	"github.com/publira/publira/server/internal/testutil"
)

const (
	integrationPayjpSecretKey     = "sk_test_PayjpIntegrationPlain"
	integrationPayjpWebhookSecret = "whook_PayjpIntegrationPlain"
)

// beforePaymentProvidersVersion is the migration before the one that lets a
// tenant hold more than one provider.
const beforePaymentProvidersVersion = 20261112153026

// beforeRetiredProviderOldPathSaveVersion is the migration before the one
// that keeps a retired provider's credentials through the previous release's
// saves.
const beforeRetiredProviderOldPathSaveVersion = 20261115140920

func stripeProvider(enabled bool) paymentsettings.ProviderInput {
	update := stripeUpdate(integrationSecretKey, integrationWebhookSecret)
	return paymentsettings.ProviderInput{Provider: update.Provider, Enabled: enabled, Currency: "JPY", Fields: update.Fields}
}

func payjpProvider(enabled bool) paymentsettings.ProviderInput {
	return paymentsettings.ProviderInput{
		Provider: payjp.ID,
		Enabled:  enabled,
		Fields: []paymentsettings.FieldUpdate{
			{Name: payjp.FieldSecretKey, Mode: secretupdate.Replace, Value: integrationPayjpSecretKey},
			{Name: payjp.FieldWebhookToken, Mode: secretupdate.Replace, Value: integrationPayjpWebhookSecret},
		},
	}
}

func heldIDs(providers paymentsettings.Providers) []string {
	var ids []string
	for _, config := range providers.List {
		id := config.Provider
		if config.Retired {
			id += " (retired)"
		}
		ids = append(ids, id)
	}
	return ids
}

func equalIDs(got []string, want ...string) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}

// retireLongAgo moves the retirement of the tenant's provider back past
// [paymentsettings.RetiredProviderGrace].
func retireLongAgo(t *testing.T, ctx context.Context, db *sql.DB, tenantID uuid.UUID, provider string) {
	t.Helper()
	if _, err := db.ExecContext(ctx, `
		UPDATE tenant_payment_providers SET retired_at = $3
		WHERE tenant_id = $1 AND provider = $2 AND retired_at IS NOT NULL
	`, tenantID, provider, time.Now().Add(-paymentsettings.RetiredProviderGrace-time.Hour)); err != nil {
		t.Fatalf("retire %s long ago: %v", provider, err)
	}
}

// configProvider answers what the previous release reads as the tenant's one
// provider.
func configProvider(t *testing.T, ctx context.Context, db dbmodels.DBTX, tenantID uuid.UUID) (string, bool, string) {
	t.Helper()
	var provider, secretKey string
	var enabled bool
	if err := db.QueryRowContext(ctx, `
		SELECT provider, enabled, COALESCE(credential_hints ->> 'secret_key', '')
		FROM tenant_payment_config
		WHERE tenant_id = $1
	`, tenantID).Scan(&provider, &enabled, &secretKey); err != nil {
		t.Fatalf("read tenant_payment_config: %v", err)
	}
	return provider, enabled, secretKey
}

// A tenant holds Stripe and PAY.JP at once, each with its own credentials,
// and the previous release goes on reading the first of them as the tenant's
// one provider.
func TestStoreHoldsMoreThanOneProvider(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	tenant := pg.SeedTenant(t, "PAYMULTI0001", "pay-multi.example.com", "Pay Multi")

	withAdminTenant(t, pg, tenant.ID, func(ctx context.Context, conn *sql.Conn) {
		store := newIntegrationStore(t, conn, &bytes.Buffer{})
		if _, err := store.UpsertProvider(ctx, tenant.ID, stripeProvider(true), paymentsettings.AuditMeta{}); err != nil {
			t.Fatalf("UpsertProvider stripe: %v", err)
		}
		held, err := store.UpsertProvider(ctx, tenant.ID, payjpProvider(true), paymentsettings.AuditMeta{})
		if err != nil {
			t.Fatalf("UpsertProvider payjp: %v", err)
		}
		if got := heldIDs(held); !equalIDs(got, stripe.ID, payjp.ID) || held.Currency != "JPY" {
			t.Fatalf("held = %v in %s, want stripe then payjp in JPY", got, held.Currency)
		}
		for _, config := range held.List {
			if !config.Ready || !config.Sells() {
				t.Fatalf("%s = %+v, want ready and selling", config.Provider, config)
			}
		}

		_, stripeCredentials, err := store.LoadProvider(ctx, tenant.ID, stripe.ID)
		if err != nil || stripeCredentials[stripe.FieldSecretKey] != integrationSecretKey {
			t.Fatalf("LoadProvider stripe = %v, want its own secret key", err)
		}
		_, payjpCredentials, err := store.LoadProvider(ctx, tenant.ID, payjp.ID)
		if err != nil || payjpCredentials[payjp.FieldSecretKey] != integrationPayjpSecretKey {
			t.Fatalf("LoadProvider payjp = %v, want its own secret key", err)
		}

		legacy, err := store.GetPublic(ctx, tenant.ID)
		if err != nil {
			t.Fatalf("GetPublic: %v", err)
		}
		if legacy.Provider != stripe.ID || !legacy.Ready {
			t.Fatalf("GetPublic = %+v, want the first provider, Stripe, ready", legacy)
		}

		// A checkout started before the removal may still be paid, so the
		// first removal retires Stripe and keeps its credentials.
		remaining, retired, err := store.RemoveProvider(ctx, tenant.ID, stripe.ID, paymentsettings.AuditMeta{})
		if err != nil {
			t.Fatalf("RemoveProvider stripe: %v", err)
		}
		if !retired || !equalIDs(heldIDs(remaining), stripe.ID+" (retired)", payjp.ID) {
			t.Fatalf("after removing stripe: retired %v, held %v; want it retired beside payjp", retired, heldIDs(remaining))
		}
		if _, credentials, err := store.LoadProvider(ctx, tenant.ID, stripe.ID); err != nil || credentials[stripe.FieldSecretKey] != integrationSecretKey {
			t.Fatalf("LoadProvider of the retired provider = %v, want its credentials kept", err)
		}
		if _, retired, err := store.RemoveProvider(ctx, tenant.ID, stripe.ID, paymentsettings.AuditMeta{}); err != nil || !retired {
			t.Fatalf("removing it again at once: retired %v, %v; want it kept retired", retired, err)
		}
	})

	if provider, enabled, hint := configProvider(t, ctx, pg.DB, tenant.ID); provider != payjp.ID || !enabled || hint != secrethint.Mask(integrationPayjpSecretKey) {
		t.Fatalf("the previous release reads %s enabled %v hint %q, want PAY.JP, the one that sells", provider, enabled, hint)
	}

	// Once the grace has passed, removing it again deletes it.
	retireLongAgo(t, ctx, pg.DB, tenant.ID, stripe.ID)
	withAdminTenant(t, pg, tenant.ID, func(ctx context.Context, conn *sql.Conn) {
		store := newIntegrationStore(t, conn, &bytes.Buffer{})
		remaining, retired, err := store.RemoveProvider(ctx, tenant.ID, stripe.ID, paymentsettings.AuditMeta{})
		if err != nil || retired || !equalIDs(heldIDs(remaining), payjp.ID) {
			t.Fatalf("removing it past the grace: retired %v, held %v, %v; want it deleted and payjp left", retired, heldIDs(remaining), err)
		}
		if _, _, err := store.LoadProvider(ctx, tenant.ID, stripe.ID); !errors.Is(err, paymentsettings.ErrProviderNotHeld) {
			t.Fatalf("LoadProvider of the removed provider error = %v, want ErrProviderNotHeld", err)
		}
		if _, _, err := store.RemoveProvider(ctx, tenant.ID, stripe.ID, paymentsettings.AuditMeta{}); !errors.Is(err, paymentsettings.ErrProviderNotHeld) {
			t.Fatalf("removing it once more error = %v, want ErrProviderNotHeld", err)
		}
	})
}

// A retired provider that still has a payment a refund may reach stays
// retired past the grace: it sells no more, and its credentials still serve
// what it took. Saving it again adds it back.
func TestStoreRetiresAProviderThatStillHasPayments(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	tenant := pg.SeedTenant(t, "PAYRETIRE001", "pay-retire.example.com", "Pay Retire")
	reader := pg.SeedEndUser(t, tenant.ID, "PAYRETIREUS1", "retire@example.com", "Reader")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "PAYRETIRESR1"})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "PAYRETIREEP1", Price: 500})

	store := newIntegrationStore(t, pg.DB, &bytes.Buffer{})
	if _, err := store.UpsertProvider(ctx, tenant.ID, stripeProvider(true), paymentsettings.AuditMeta{}); err != nil {
		t.Fatalf("UpsertProvider stripe: %v", err)
	}
	if _, err := store.UpsertProvider(ctx, tenant.ID, payjpProvider(true), paymentsettings.AuditMeta{}); err != nil {
		t.Fatalf("UpsertProvider payjp: %v", err)
	}
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO purchases (id, tenant_id, user_id, episode_id, price_at_purchase, currency, purchased_at,
			provider, provider_checkout_id, provider_payment_id)
		VALUES ($1, $2, $3, $4, 500, 'JPY', now(), 'stripe', 'cs_retire', 'pi_retire')
	`, uuid.New(), tenant.ID, reader.ID, episode.ID); err != nil {
		t.Fatalf("insert purchase: %v", err)
	}

	held, retired, err := store.RemoveProvider(ctx, tenant.ID, stripe.ID, paymentsettings.AuditMeta{})
	if err != nil {
		t.Fatalf("RemoveProvider stripe: %v", err)
	}
	if !retired || !equalIDs(heldIDs(held), stripe.ID+" (retired)", payjp.ID) {
		t.Fatalf("retired %v, held %v; want stripe retired beside payjp", retired, heldIDs(held))
	}
	config, credentials, err := store.LoadProvider(ctx, tenant.ID, stripe.ID)
	if err != nil || !config.Retired || config.Sells() || credentials[stripe.FieldSecretKey] != integrationSecretKey {
		t.Fatalf("LoadProvider of the retired provider = %+v, %v; want its credentials and no sales", config, err)
	}
	if provider, _, _ := configProvider(t, ctx, pg.DB, tenant.ID); provider != payjp.ID {
		t.Fatalf("the previous release reads %s, want PAY.JP, the first one that sells", provider)
	}

	retireLongAgo(t, ctx, pg.DB, tenant.ID, stripe.ID)
	if _, retired, err := store.RemoveProvider(ctx, tenant.ID, stripe.ID, paymentsettings.AuditMeta{}); err != nil || !retired {
		t.Fatalf("removing it past the grace with a payment left: retired %v, %v; want it kept retired", retired, err)
	}

	// Once nothing is left for it to refund, removing it again deletes it.
	if _, err := pg.DB.ExecContext(ctx, `UPDATE purchases SET refunded_amount = 500, refunded_at = now(), revoked_at = now(), revocation_reason = 'refund' WHERE tenant_id = $1`, tenant.ID); err != nil {
		t.Fatalf("refund the purchase: %v", err)
	}
	if _, retired, err := store.RemoveProvider(ctx, tenant.ID, stripe.ID, paymentsettings.AuditMeta{}); err != nil || retired {
		t.Fatalf("RemoveProvider once refunded: retired %v, %v; want it deleted", retired, err)
	}

	// Saving a retired provider adds it back.
	if _, _, err := store.RemoveProvider(ctx, tenant.ID, payjp.ID, paymentsettings.AuditMeta{}); err != nil {
		t.Fatalf("RemoveProvider payjp: %v", err)
	}
	if _, err := store.UpsertProvider(ctx, tenant.ID, paymentsettings.ProviderInput{Provider: payjp.ID, Enabled: true}, paymentsettings.AuditMeta{}); err != nil {
		t.Fatalf("UpsertProvider adding payjp back: %v", err)
	}
	if config, _, err := store.LoadProvider(ctx, tenant.ID, payjp.ID); err != nil || config.Retired || !config.Sells() {
		t.Fatalf("payjp saved again = %+v, %v; want it selling", config, err)
	}
}

// Every provider the tenant sells through charges in the tenant's currency,
// so a provider that does not is refused beside it, and a currency one of
// them does not charge in is refused for all of them.
func TestStoreHoldsTheCurrencyToEveryProvider(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	tenant := pg.SeedTenant(t, "PAYCURR00001", "pay-currency.example.com", "Pay Currency")

	store := newIntegrationStore(t, pg.DB, &bytes.Buffer{})
	usd := stripeProvider(true)
	usd.Currency = "USD"
	if _, err := store.UpsertProvider(ctx, tenant.ID, usd, paymentsettings.AuditMeta{}); err != nil {
		t.Fatalf("UpsertProvider stripe in USD: %v", err)
	}
	if _, err := store.UpsertProvider(ctx, tenant.ID, payjpProvider(true), paymentsettings.AuditMeta{}); !errors.Is(err, paymentsettings.ErrUnsupportedCurrency) {
		t.Fatalf("adding PAY.JP to a tenant selling in USD error = %v, want ErrUnsupportedCurrency", err)
	}
	jpy := payjpProvider(true)
	jpy.Currency = "JPY"
	if _, err := store.UpsertProvider(ctx, tenant.ID, jpy, paymentsettings.AuditMeta{}); err != nil {
		t.Fatalf("adding PAY.JP in JPY: %v", err)
	}
	usd.Fields = nil
	if _, err := store.UpsertProvider(ctx, tenant.ID, usd, paymentsettings.AuditMeta{}); !errors.Is(err, paymentsettings.ErrUnsupportedCurrency) {
		t.Fatalf("moving back to USD beside PAY.JP error = %v, want ErrUnsupportedCurrency", err)
	}
	if _, err := store.Upsert(ctx, tenant.ID, paymentsettings.UpdateInput{Provider: stripe.ID, Enabled: true, Currency: "USD"}, paymentsettings.AuditMeta{}); !errors.Is(err, paymentsettings.ErrUnsupportedCurrency) {
		t.Fatalf("the single-provider save moving to USD beside PAY.JP error = %v, want ErrUnsupportedCurrency", err)
	}
}

// The previous release saves the tenant's one provider in
// tenant_payment_config, as a tenant_admin under row-level security, and the
// tenant's providers follow: a change to the first one reaches it, and a
// switch puts the new provider in its place and keeps the others.
func TestPreviousReleaseWritesReachTheTenantsProviders(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)
	tenant := pg.SeedTenant(t, "PAYOLDREL001", "pay-old.example.com", "Pay Old")

	withAdminTenant(t, pg, tenant.ID, func(ctx context.Context, conn *sql.Conn) {
		store := newIntegrationStore(t, conn, &bytes.Buffer{})
		if _, err := store.UpsertProvider(ctx, tenant.ID, stripeProvider(true), paymentsettings.AuditMeta{}); err != nil {
			t.Fatalf("UpsertProvider stripe: %v", err)
		}
		if _, err := store.UpsertProvider(ctx, tenant.ID, payjpProvider(true), paymentsettings.AuditMeta{}); err != nil {
			t.Fatalf("UpsertProvider payjp: %v", err)
		}

		// The previous release turns its one provider off.
		queries := dbmodels.New(conn)
		row, err := queries.GetTenantPaymentConfigByTenantID(ctx, tenant.ID)
		if err != nil {
			t.Fatalf("GetTenantPaymentConfigByTenantID: %v", err)
		}
		if _, err := queries.UpsertTenantPaymentConfig(ctx, dbmodels.UpsertTenantPaymentConfigParams{
			TenantID: tenant.ID, Provider: row.Provider, Enabled: false,
			CredentialsEncrypted: row.CredentialsEncrypted, CredentialHints: row.CredentialHints, Currency: row.Currency,
		}); err != nil {
			t.Fatalf("the previous release's save: %v", err)
		}
		held, err := store.Providers(ctx, tenant.ID)
		if err != nil {
			t.Fatalf("Providers: %v", err)
		}
		if config, _ := held.Lookup(stripe.ID); config.Enabled {
			t.Fatal("Stripe is still on after the previous release turned it off")
		}
		if config, _ := held.Lookup(payjp.ID); !config.Enabled {
			t.Fatal("PAY.JP was turned off with Stripe")
		}

		// The previous release switches its one provider to PAY.JP, which
		// retires Stripe and leaves PAY.JP the fields it has.
		switched, err := store.Upsert(ctx, tenant.ID, paymentsettings.UpdateInput{Provider: payjp.ID, Enabled: false}, paymentsettings.AuditMeta{})
		if err != nil {
			t.Fatalf("switch to PAY.JP: %v", err)
		}
		if field, _ := switched.Field(payjp.FieldSecretKey); switched.Provider != payjp.ID || !field.Configured {
			t.Fatalf("the switch answers %+v, want PAY.JP with the fields it has", switched)
		}
		held, err = store.Providers(ctx, tenant.ID)
		if err != nil {
			t.Fatalf("Providers: %v", err)
		}
		if !equalIDs(heldIDs(held), stripe.ID+" (retired)", payjp.ID) {
			t.Fatalf("held after the switch = %v, want Stripe retired and PAY.JP in its place", heldIDs(held))
		}
		if config, _ := held.Lookup(payjp.ID); config.Enabled || len(config.Fields) == 0 || !config.Fields[0].Configured {
			t.Fatalf("PAY.JP after the switch = %+v, want it off with its fields kept", config)
		}
	})
}

// previousReleaseSave saves the tenant's one provider the way the previous
// release's paymentsettings.Store.Upsert does: it reads tenant_payment_config,
// carries the stored fields over when provider is the one stored there and
// starts from none when it is another, replaces the fields in typed, clears
// the ones in cleared, and writes the row back whole, which a change of the
// currency alone does too.
func previousReleaseSave(t *testing.T, ctx context.Context, conn dbmodels.DBTX, tenantID uuid.UUID, provider string, enabled bool, typed map[string]string, cleared ...string) {
	t.Helper()
	queries := dbmodels.New(conn)
	row, err := queries.GetTenantPaymentConfigByTenantID(ctx, tenantID)
	if err != nil {
		t.Fatalf("the previous release's read: %v", err)
	}
	encrypted := map[string]string{}
	hints := map[string]string{}
	if row.Provider == provider {
		if err := json.Unmarshal(row.CredentialsEncrypted, &encrypted); err != nil {
			t.Fatalf("decode stored credentials: %v", err)
		}
		if err := json.Unmarshal(row.CredentialHints, &hints); err != nil {
			t.Fatalf("decode stored hints: %v", err)
		}
	}
	mgr := integrationEncryptor(t)
	for name, value := range typed {
		envelope, err := mgr.EncryptString(value)
		if err != nil {
			t.Fatalf("EncryptString: %v", err)
		}
		encrypted[name] = envelope
		hints[name] = secrethint.Mask(value)
	}
	for _, name := range cleared {
		delete(encrypted, name)
		delete(hints, name)
	}
	encryptedJSON, err := json.Marshal(encrypted)
	if err != nil {
		t.Fatalf("encode credentials: %v", err)
	}
	hintsJSON, err := json.Marshal(hints)
	if err != nil {
		t.Fatalf("encode hints: %v", err)
	}
	if _, err := queries.UpsertTenantPaymentConfig(ctx, dbmodels.UpsertTenantPaymentConfigParams{
		TenantID: tenantID, Provider: provider, Enabled: enabled,
		CredentialsEncrypted: encryptedJSON, CredentialHints: hintsJSON, Currency: row.Currency,
	}); err != nil {
		t.Fatalf("the previous release's save of %s: %v", provider, err)
	}
}

// loadRetired answers the credentials of provider, which the tenant holds
// retired, as the notification, the refund, and the reconciliation of what it
// took load them.
func loadRetired(t *testing.T, ctx context.Context, store *paymentsettings.Store, tenantID uuid.UUID, provider string) map[string]string {
	t.Helper()
	config, credentials, err := store.LoadProvider(ctx, tenantID, provider)
	if err != nil {
		t.Fatalf("LoadProvider of the retired %s: %v", provider, err)
	}
	if !config.Retired || config.Sells() {
		t.Fatalf("%s = %+v, want it retired", provider, config)
	}
	return credentials
}

// The previous release shows a tenant whose providers are all retired the
// first of them, switched off, and its saves leave that provider retired with
// the credentials it serves what it took with, until a save switches it on.
func TestPreviousReleaseSavesKeepARetiredProvidersCredentials(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)
	tenant := pg.SeedTenant(t, "PAYOLDRET001", "pay-old-retired.example.com", "Pay Old Retired")

	withAdminTenant(t, pg, tenant.ID, func(ctx context.Context, conn *sql.Conn) {
		store := newIntegrationStore(t, conn, &bytes.Buffer{})
		if _, err := store.UpsertProvider(ctx, tenant.ID, stripeProvider(true), paymentsettings.AuditMeta{}); err != nil {
			t.Fatalf("UpsertProvider stripe: %v", err)
		}
		if _, retired, err := store.RemoveProvider(ctx, tenant.ID, stripe.ID, paymentsettings.AuditMeta{}); err != nil || !retired {
			t.Fatalf("RemoveProvider stripe: retired %v, %v; want it retired", retired, err)
		}
		if provider, enabled, hint := configProvider(t, ctx, conn, tenant.ID); provider != stripe.ID || enabled || hint != secrethint.Mask(integrationSecretKey) {
			t.Fatalf("the previous release reads %s enabled %v hint %q, want Stripe off with its fields", provider, enabled, hint)
		}

		for round := range 2 {
			previousReleaseSave(t, ctx, conn, tenant.ID, stripe.ID, false, nil)
			credentials := loadRetired(t, ctx, store, tenant.ID, stripe.ID)
			if credentials[stripe.FieldSecretKey] != integrationSecretKey || credentials[stripe.FieldWebhookSecret] != integrationWebhookSecret {
				t.Fatalf("round %d: the retired Stripe's credentials after the previous release's save = %v, want them kept", round, credentials)
			}
			// This release removing it again within the grace keeps it
			// retired, and the previous release saves once more.
			if _, retired, err := store.RemoveProvider(ctx, tenant.ID, stripe.ID, paymentsettings.AuditMeta{}); err != nil || !retired {
				t.Fatalf("round %d: RemoveProvider stripe again: retired %v, %v; want it kept retired", round, retired, err)
			}
		}

		// Switched on, the previous release adds it back, with its fields.
		previousReleaseSave(t, ctx, conn, tenant.ID, stripe.ID, true, nil)
		config, credentials, err := store.LoadProvider(ctx, tenant.ID, stripe.ID)
		if err != nil || !config.Sells() || credentials[stripe.FieldWebhookSecret] != integrationWebhookSecret {
			t.Fatalf("Stripe switched on by the previous release = %+v, %v; want it selling with its credentials", config, err)
		}
	})
}

// The previous release switching its one provider to another retires the
// provider switched from, with its credentials, where that release deletes
// them, and adds the fields typed in to the ones a provider the tenant holds
// already has.
func TestPreviousReleaseSwitchRetiresTheProviderSwitchedFrom(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)
	tenant := pg.SeedTenant(t, "PAYOLDSWT001", "pay-old-switch.example.com", "Pay Old Switch")

	withAdminTenant(t, pg, tenant.ID, func(ctx context.Context, conn *sql.Conn) {
		store := newIntegrationStore(t, conn, &bytes.Buffer{})
		if _, err := store.UpsertProvider(ctx, tenant.ID, stripeProvider(true), paymentsettings.AuditMeta{}); err != nil {
			t.Fatalf("UpsertProvider stripe: %v", err)
		}

		previousReleaseSave(t, ctx, conn, tenant.ID, payjp.ID, true, map[string]string{
			payjp.FieldSecretKey:    integrationPayjpSecretKey,
			payjp.FieldWebhookToken: integrationPayjpWebhookSecret,
		})
		held, err := store.Providers(ctx, tenant.ID)
		if err != nil {
			t.Fatalf("Providers: %v", err)
		}
		if !equalIDs(heldIDs(held), stripe.ID+" (retired)", payjp.ID) {
			t.Fatalf("held after the switch to PAY.JP = %v, want Stripe retired beside it", heldIDs(held))
		}
		if credentials := loadRetired(t, ctx, store, tenant.ID, stripe.ID); credentials[stripe.FieldSecretKey] != integrationSecretKey || credentials[stripe.FieldWebhookSecret] != integrationWebhookSecret {
			t.Fatalf("the retired Stripe's credentials = %v, want them kept", credentials)
		}
		if config, credentials, err := store.LoadProvider(ctx, tenant.ID, payjp.ID); err != nil || !config.Sells() || credentials[payjp.FieldSecretKey] != integrationPayjpSecretKey {
			t.Fatalf("PAY.JP after the switch = %+v, %v; want it selling with what was typed", config, err)
		}

		// This release adds Stripe back, which keeps the fields it has and
		// makes it the first provider again, the one the previous release
		// shows.
		if _, err := store.UpsertProvider(ctx, tenant.ID, paymentsettings.ProviderInput{Provider: stripe.ID, Enabled: true}, paymentsettings.AuditMeta{}); err != nil {
			t.Fatalf("UpsertProvider adding stripe back: %v", err)
		}
		if provider, _, _ := configProvider(t, ctx, conn, tenant.ID); provider != stripe.ID {
			t.Fatalf("the previous release reads %s, want Stripe added back", provider)
		}

		// Switching to PAY.JP again, the previous release sends only the
		// token typed in, which is added to the secret key PAY.JP has.
		const newWebhookToken = "whook_PayjpReplacedPlain"
		previousReleaseSave(t, ctx, conn, tenant.ID, payjp.ID, false, map[string]string{payjp.FieldWebhookToken: newWebhookToken})
		if credentials := loadRetired(t, ctx, store, tenant.ID, stripe.ID); credentials[stripe.FieldSecretKey] != integrationSecretKey {
			t.Fatalf("Stripe retired a second time has %v, want its credentials kept", credentials)
		}
		held, err = store.Providers(ctx, tenant.ID)
		if err != nil {
			t.Fatalf("Providers: %v", err)
		}
		if !equalIDs(heldIDs(held), stripe.ID+" (retired)", payjp.ID) {
			t.Fatalf("held after the second switch = %v, want Stripe retired beside PAY.JP", heldIDs(held))
		}
		if _, enabled, hint := configProvider(t, ctx, conn, tenant.ID); enabled || hint != secrethint.Mask(integrationPayjpSecretKey) {
			t.Fatalf("the previous release reads enabled %v secret key %q, want PAY.JP off with the secret key it has", enabled, hint)
		}

		// The previous release then carries every field PAY.JP has over.
		previousReleaseSave(t, ctx, conn, tenant.ID, payjp.ID, true, nil)
		config, credentials, err := store.LoadProvider(ctx, tenant.ID, payjp.ID)
		if err != nil || !config.Sells() || credentials[payjp.FieldSecretKey] != integrationPayjpSecretKey || credentials[payjp.FieldWebhookToken] != newWebhookToken {
			t.Fatalf("PAY.JP switched on = %+v, %v; want it selling with its secret key and the new token", config, err)
		}
	})
}

// The migration copies each tenant's one provider into the tenant's
// providers, ready as it was.
func TestPaymentProvidersMigrationCopiesTheTenantsProvider(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)
	pg.MigrateTo(t, beforePaymentProvidersVersion)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenantOnOlderSchema(t, "PAYMIGPRV001", "pay-migrate.example.com", "Pay Migrate")
	mgr := integrationEncryptor(t)
	secretEncrypted, err := mgr.EncryptString(integrationSecretKey)
	if err != nil {
		t.Fatalf("EncryptString: %v", err)
	}
	webhookEncrypted, err := mgr.EncryptString(integrationWebhookSecret)
	if err != nil {
		t.Fatalf("EncryptString: %v", err)
	}
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO tenant_payment_config (tenant_id, provider, enabled, credentials_encrypted, credential_hints, currency)
		VALUES ($1, 'stripe', true, jsonb_build_object('secret_key', $2::text, 'webhook_secret', $3::text),
			jsonb_build_object('secret_key', $4::text, 'webhook_secret', $5::text), 'JPY')
	`, tenant.ID, secretEncrypted, webhookEncrypted,
		secrethint.Mask(integrationSecretKey), secrethint.Mask(integrationWebhookSecret)); err != nil {
		t.Fatalf("insert the previous release's settings: %v", err)
	}
	pg.MigrateUp(t)

	store := newIntegrationStore(t, pg.DB, &bytes.Buffer{})
	config, credentials, err := store.LoadProvider(ctx, tenant.ID, stripe.ID)
	if err != nil {
		t.Fatalf("LoadProvider: %v", err)
	}
	if !config.Ready || config.Retired || credentials[stripe.FieldSecretKey] != integrationSecretKey || credentials[stripe.FieldWebhookSecret] != integrationWebhookSecret {
		t.Fatalf("migrated provider = %+v, want Stripe ready with its credentials", config)
	}
	if currency, err := store.Currency(ctx, tenant.ID); err != nil || currency != "JPY" {
		t.Fatalf("Currency = %q, %v; want JPY kept", currency, err)
	}
}

// Switched off to a retired provider, the previous release leaves it
// retired, and the settings row goes on showing it, so the previous release's
// next save of it is of every field it has and clears the one it leaves out.
func TestPreviousReleaseSaveOfARetiredProviderSwitchedToClearsAField(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)
	tenant := pg.SeedTenant(t, "PAYOLDCLR001", "pay-old-clear.example.com", "Pay Old Clear")

	withAdminTenant(t, pg, tenant.ID, func(ctx context.Context, conn *sql.Conn) {
		store := newIntegrationStore(t, conn, &bytes.Buffer{})
		if _, err := store.UpsertProvider(ctx, tenant.ID, stripeProvider(true), paymentsettings.AuditMeta{}); err != nil {
			t.Fatalf("UpsertProvider stripe: %v", err)
		}
		if _, err := store.UpsertProvider(ctx, tenant.ID, payjpProvider(true), paymentsettings.AuditMeta{}); err != nil {
			t.Fatalf("UpsertProvider payjp: %v", err)
		}
		if _, retired, err := store.RemoveProvider(ctx, tenant.ID, payjp.ID, paymentsettings.AuditMeta{}); err != nil || !retired {
			t.Fatalf("RemoveProvider payjp: retired %v, %v; want it retired", retired, err)
		}

		previousReleaseSave(t, ctx, conn, tenant.ID, payjp.ID, false, nil)
		if provider, enabled, hint := configProvider(t, ctx, conn, tenant.ID); provider != payjp.ID || enabled || hint != secrethint.Mask(integrationPayjpSecretKey) {
			t.Fatalf("the previous release reads %s enabled %v hint %q, want PAY.JP off with its fields", provider, enabled, hint)
		}

		previousReleaseSave(t, ctx, conn, tenant.ID, payjp.ID, false, nil, payjp.FieldWebhookToken)
		held, err := store.Held(ctx, tenant.ID)
		if err != nil {
			t.Fatalf("Held: %v", err)
		}
		for _, config := range held {
			if config.Provider != payjp.ID {
				continue
			}
			secretKey, _ := config.Field(payjp.FieldSecretKey)
			token, _ := config.Field(payjp.FieldWebhookToken)
			if !config.Retired || !secretKey.Configured || token.Configured {
				t.Fatalf("PAY.JP after clearing its token = %+v, want it retired with its secret key and no token", config)
			}
			return
		}
		t.Fatalf("held = %+v, want PAY.JP among them", held)
	})
}

// A tenant whose every provider was retired before the upgrade has a settings
// row that shows nothing stored, and the migration shows the provider's
// credentials there, so the previous release's next save keeps them.
func TestRetiredProviderMigrationShowsTheRetiredProvidersCredentials(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)
	pg.MigrateTo(t, beforeRetiredProviderOldPathSaveVersion)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenantOnOlderSchema(t, "PAYMIGRET001", "pay-migrate-retired.example.com", "Pay Migrate Retired")
	mgr := integrationEncryptor(t)
	secretEncrypted, err := mgr.EncryptString(integrationSecretKey)
	if err != nil {
		t.Fatalf("EncryptString: %v", err)
	}
	webhookEncrypted, err := mgr.EncryptString(integrationWebhookSecret)
	if err != nil {
		t.Fatalf("EncryptString: %v", err)
	}
	for _, statement := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO tenant_payment_config (tenant_id, provider, enabled, currency) VALUES ($1, 'stripe', false, 'JPY')`, []any{tenant.ID}},
		{`UPDATE tenant_payment_providers
			SET enabled = true,
				credentials_encrypted = jsonb_build_object('secret_key', $2::text, 'webhook_secret', $3::text),
				credential_hints = jsonb_build_object('secret_key', $4::text, 'webhook_secret', $5::text)
			WHERE tenant_id = $1`, []any{tenant.ID, secretEncrypted, webhookEncrypted, secrethint.Mask(integrationSecretKey), secrethint.Mask(integrationWebhookSecret)}},
		{`UPDATE tenant_payment_providers SET retired_at = now() WHERE tenant_id = $1`, []any{tenant.ID}},
	} {
		if _, err := pg.DB.ExecContext(ctx, statement.query, statement.args...); err != nil {
			t.Fatalf("set up the retired provider on the older schema: %v", err)
		}
	}
	if _, _, hint := configProvider(t, ctx, pg.DB, tenant.ID); hint != "" {
		t.Fatalf("the settings row before the migration shows secret key %q, want nothing stored", hint)
	}

	pg.MigrateUp(t)
	if provider, enabled, hint := configProvider(t, ctx, pg.DB, tenant.ID); provider != stripe.ID || enabled || hint != secrethint.Mask(integrationSecretKey) {
		t.Fatalf("the previous release reads %s enabled %v hint %q, want Stripe off with its fields", provider, enabled, hint)
	}

	previousReleaseSave(t, ctx, pg.DB, tenant.ID, stripe.ID, false, nil)
	store := newIntegrationStore(t, pg.DB, &bytes.Buffer{})
	if credentials := loadRetired(t, ctx, store, tenant.ID, stripe.ID); credentials[stripe.FieldSecretKey] != integrationSecretKey || credentials[stripe.FieldWebhookSecret] != integrationWebhookSecret {
		t.Fatalf("the retired Stripe's credentials after the previous release's save = %v, want them kept", credentials)
	}
}
