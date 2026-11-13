package paymentsettings_test

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/paymentprovider/payjp"
	"github.com/publira/publira/server/internal/paymentprovider/stripe"
	"github.com/publira/publira/server/internal/paymentsettings"
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
func configProvider(t *testing.T, ctx context.Context, db *sql.DB, tenantID uuid.UUID) (string, bool, string) {
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

	if provider, enabled, hint := configProvider(t, ctx, pg.DB, tenant.ID); provider != payjp.ID || !enabled || hint != paymentsettings.MaskSecret(integrationPayjpSecretKey) {
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
		// deletes Stripe's credentials in that release.
		if _, err := store.Upsert(ctx, tenant.ID, paymentsettings.UpdateInput{Provider: payjp.ID, Enabled: false}, paymentsettings.AuditMeta{}); err != nil {
			t.Fatalf("switch to PAY.JP: %v", err)
		}
		held, err = store.Providers(ctx, tenant.ID)
		if err != nil {
			t.Fatalf("Providers: %v", err)
		}
		if !equalIDs(heldIDs(held), payjp.ID) {
			t.Fatalf("held after the switch = %v, want PAY.JP in Stripe's place", heldIDs(held))
		}
		if config, _ := held.Lookup(payjp.ID); config.Enabled || len(config.Fields) == 0 || config.Fields[0].Configured {
			t.Fatalf("PAY.JP after the switch = %+v, want it off with no field stored", config)
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
		paymentsettings.MaskSecret(integrationSecretKey), paymentsettings.MaskSecret(integrationWebhookSecret)); err != nil {
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
