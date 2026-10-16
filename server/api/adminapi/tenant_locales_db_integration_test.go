package adminapi

import (
	"context"
	"slices"
	"testing"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/outbox"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// The default and the locales the site offers are saved by one request, and a
// save that changes either of them is one the audit log answers for, and one
// that rewrites the tenant's search documents, whose fallback translation
// moves with the default. A request whose set leaves out its default changes
// neither.
func TestDBUpdateTenantDefaultLocaleSavesTheSetWithTheDefault(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TLCTNNT1", "locales.example.com", "Locales", "TLCUSER1", "admin@locales.example.com")
	ctx := testutil.WithBearer(context.Background(), tenant.token())
	settings := env.tenantSettingsClient()

	assertLocales := func(t *testing.T, wantDefault string, wantSupported []string) {
		t.Helper()
		got, err := settings.GetTenantDefaultLocale(ctx, &publiraadminv1.GetTenantDefaultLocaleRequest{Tenant: tenant.tenantContext()})
		if err != nil {
			t.Fatalf("GetTenantDefaultLocale: %v", err)
		}
		if got.DefaultLocale != wantDefault || !slices.Equal(got.SupportedLocales, wantSupported) {
			t.Fatalf("locales = %q %q, want %q %q", got.DefaultLocale, got.SupportedLocales, wantDefault, wantSupported)
		}
	}

	tenantSyncs := func(t *testing.T) int {
		t.Helper()
		var queued int
		if err := env.PG.DB.QueryRowContext(context.Background(),
			"SELECT count(*) FROM outbox_events WHERE event_type = $1 AND payload->>'kind' = 'tenant' AND payload->>'id' = $2",
			outbox.EventTypeCatalogIndexSync, tenant.Tenant.ID.String(),
		).Scan(&queued); err != nil {
			t.Fatalf("count the catalog index syncs of the tenant: %v", err)
		}
		return queued
	}

	saves := []struct {
		name             string
		defaultLocale    string
		supportedLocales []string
		wantSupported    []string
		wantTenantSyncs  int
	}{
		{name: "both", defaultLocale: "en", supportedLocales: []string{"en", "ja"}, wantSupported: []string{"ja", "en"}, wantTenantSyncs: 1},
		{name: "the set alone", defaultLocale: "en", supportedLocales: []string{"zh-Hans", "en"}, wantSupported: []string{"en", "zh-Hans"}, wantTenantSyncs: 2},
		{name: "the default to a locale that was off", defaultLocale: "ko", supportedLocales: []string{"ko", "en", "zh-Hans"}, wantSupported: []string{"en", "ko", "zh-Hans"}, wantTenantSyncs: 3},
	}
	for i, save := range saves {
		resp, err := settings.UpdateTenantDefaultLocale(ctx, &publiraadminv1.UpdateTenantDefaultLocaleRequest{
			Tenant:           tenant.tenantContext(),
			DefaultLocale:    save.defaultLocale,
			SupportedLocales: save.supportedLocales,
		})
		if err != nil {
			t.Fatalf("save %s: %v", save.name, err)
		}
		if resp.DefaultLocale != save.defaultLocale || !slices.Equal(resp.SupportedLocales, save.wantSupported) {
			t.Fatalf("save %s answered %q %q, want %q %q", save.name, resp.DefaultLocale, resp.SupportedLocales, save.defaultLocale, save.wantSupported)
		}
		assertLocales(t, save.defaultLocale, save.wantSupported)
		if got := tenantSettingAuditCount(t, env, tenant, "tenant_default_locale_updated", "tenant_default_locale"); got != i+1 {
			t.Fatalf("after save %s: audit entries = %d, want %d", save.name, got, i+1)
		}
		if got := tenantSyncs(t); got != save.wantTenantSyncs {
			t.Fatalf("after save %s: tenant search syncs = %d, want %d", save.name, got, save.wantTenantSyncs)
		}
	}

	_, err := settings.UpdateTenantDefaultLocale(ctx, &publiraadminv1.UpdateTenantDefaultLocaleRequest{
		Tenant:           tenant.tenantContext(),
		DefaultLocale:    "ja",
		SupportedLocales: []string{"ko"},
	})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("a set without its default: code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	assertLocales(t, "ko", []string{"en", "ko", "zh-Hans"})
	if got := tenantSyncs(t); got != 3 {
		t.Fatalf("after a refused save: tenant search syncs = %d, want 3", got)
	}
}
