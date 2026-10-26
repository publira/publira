package adminapi

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"connectrpc.com/connect/v2/connectproto"
	"google.golang.org/genproto/googleapis/rpc/errdetails"

	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/paymentprovider/stripe"
	"github.com/publira/publira/server/internal/platformpolicy"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/testutil"
)

func (e *adminDBEnv) coinClient() publiraadminv1connect.AdminCoinServiceClient {
	return publiraadminv1connect.NewAdminCoinServiceClient(connect.NewClient(connecthttp.NewTransport(e.Server.Client(), e.Server.URL)))
}

// coinFixture is a tenant whose default locale is ja, with an admin to save
// its coin settings as.
type coinFixture struct {
	env   *adminDBEnv
	admin adminDBTenant
}

func newCoinFixture(t *testing.T) *coinFixture {
	t.Helper()

	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAADMIN01", "admin@tenant-a.example.com")
	return &coinFixture{env: env, admin: admin}
}

func (f *coinFixture) ctx() context.Context {
	return testutil.WithBearer(context.Background(), f.admin.token())
}

// allowCoins saves a platform policy that allows tenant coins or forbids them.
func (f *coinFixture) allowCoins(t *testing.T, allowed bool) {
	t.Helper()

	if f.env.countRows(t, `SELECT count(*) FROM platform_policy_config`) == 0 {
		policy := platformpolicy.Defaults()
		policy.TenantCoinsAllowed = allowed
		f.env.PG.SavePlatformPolicy(t, policy)
		return
	}
	if _, err := f.env.PG.DB.ExecContext(context.Background(), `UPDATE platform_policy_config SET tenant_coins_allowed = $1`, allowed); err != nil {
		t.Fatalf("set tenant_coins_allowed: %v", err)
	}
}

// takePayments makes the tenant's Stripe settings ready, which is a way to
// sell a pack.
func (f *coinFixture) takePayments(t *testing.T) {
	t.Helper()

	if _, err := f.env.paymentClient().UpdateTenantPaymentSettings(f.ctx(), &publiraadminv1.UpdateTenantPaymentSettingsRequest{
		Tenant:   f.admin.tenantContext(),
		Provider: stripe.ID,
		Enabled:  true,
		Currency: "JPY",
		Fields: []*publiraadminv1.PaymentCredentialFieldUpdate{
			{Name: stripe.FieldSecretKey, Mode: publiraadminv1.SecretUpdateMode_SECRET_UPDATE_MODE_REPLACE, Value: "sk_test_51CoinSettingsAAAA"},
			{Name: stripe.FieldWebhookSecret, Mode: publiraadminv1.SecretUpdateMode_SECRET_UPDATE_MODE_REPLACE, Value: "whsec_CoinSettingsAAAA"},
		},
	}); err != nil {
		t.Fatalf("save the Stripe settings: %v", err)
	}
}

func (f *coinFixture) save(settings *publiraadminv1.TenantCoinSettings) (*publiraadminv1.UpdateTenantCoinSettingsResponse, error) {
	return f.env.coinClient().UpdateTenantCoinSettings(f.ctx(), &publiraadminv1.UpdateTenantCoinSettingsRequest{
		Tenant:   f.admin.tenantContext(),
		Settings: settings,
	})
}

// otherCurrency is a currency the tenant does not sell in.
func (f *coinFixture) otherCurrency(t *testing.T) string {
	t.Helper()

	got, err := f.env.coinClient().GetTenantCoinSettings(f.ctx(), &publiraadminv1.GetTenantCoinSettingsRequest{Tenant: f.admin.tenantContext()})
	if err != nil {
		t.Fatalf("GetTenantCoinSettings: %v", err)
	}
	if got.GetCurrency() == "JPY" {
		return "USD"
	}
	return "JPY"
}

func (f *coinFixture) auditCount(t *testing.T, action string) int {
	t.Helper()
	return f.env.countRows(t, `SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = $2`, f.admin.Tenant.ID, action)
}

// completeCoinSettings turns coins on with everything they need.
func completeCoinSettings() *publiraadminv1.TenantCoinSettings {
	return &publiraadminv1.TenantCoinSettings{
		Enabled:        true,
		Selling:        true,
		CoinUnitAmount: 1,
		ExpiryDays:     180,
		IssuerName:     "Tenant A Inc.",
		TermsUrl:       "https://tenant-a.example.com/coins/terms",
		Contact:        "coins@tenant-a.example.com",
		Notice:         "Coins expire 180 days after purchase and are not refunded.",
		Names: []*publiraadminv1.CoinNameTranslation{
			{Locale: "ja", Name: "Tickets"},
			{Locale: "en", Name: "Points"},
		},
	}
}

func TestDBTenantCoinSettingsStartOff(t *testing.T) {
	f := newCoinFixture(t)

	got, err := f.env.coinClient().GetTenantCoinSettings(f.ctx(), &publiraadminv1.GetTenantCoinSettingsRequest{Tenant: f.admin.tenantContext()})
	if err != nil {
		t.Fatalf("GetTenantCoinSettings: %v", err)
	}
	settings := got.GetSettings()
	if settings.GetEnabled() || settings.GetSelling() {
		t.Fatalf("enabled, selling = %v, %v, want both false", settings.GetEnabled(), settings.GetSelling())
	}
	if len(settings.GetNames()) != 0 {
		t.Fatalf("names = %v, want none", settings.GetNames())
	}
	if settings.GetIssuerName() != "" || settings.GetTermsUrl() != "" || settings.GetContact() != "" || settings.GetNotice() != "" {
		t.Fatalf("disclosures = %#v, want every one empty", settings)
	}
	if settings.GetCoinUnitAmount() != 0 || settings.GetExpiryDays() != 0 {
		t.Fatalf("coin_unit_amount, expiry_days = %d, %d, want both unset", settings.GetCoinUnitAmount(), settings.GetExpiryDays())
	}
	if got.GetPlatformAllowsCoins() {
		t.Fatal("platform_allows_coins = true before any policy is saved")
	}
	if got.GetCurrency() == "" {
		t.Fatal("currency is empty, want the platform's default")
	}
}

// Turning coins on names the first field it is missing, and is refused while
// the platform forbids coins or the tenant has no way to sell a pack. Once all
// of those hold it goes through, and the save is in the audit log.
func TestDBUpdateTenantCoinSettingsTurnsCoinsOnOnlyWhenEverythingHolds(t *testing.T) {
	f := newCoinFixture(t)

	for _, tc := range []struct {
		name   string
		change func(*publiraadminv1.TenantCoinSettings)
		field  string
	}{
		{name: "no coin value", change: func(s *publiraadminv1.TenantCoinSettings) { s.CoinUnitAmount = 0 }, field: "settings.coin_unit_amount"},
		{name: "no expiry", change: func(s *publiraadminv1.TenantCoinSettings) { s.ExpiryDays = 0 }, field: "settings.expiry_days"},
		{name: "no issuer", change: func(s *publiraadminv1.TenantCoinSettings) { s.IssuerName = "  " }, field: "settings.issuer_name"},
		{name: "no terms", change: func(s *publiraadminv1.TenantCoinSettings) { s.TermsUrl = "" }, field: "settings.terms_url"},
		{name: "no contact", change: func(s *publiraadminv1.TenantCoinSettings) { s.Contact = "" }, field: "settings.contact"},
		{name: "no notice", change: func(s *publiraadminv1.TenantCoinSettings) { s.Notice = "" }, field: "settings.notice"},
		{name: "no name in the default locale", change: func(s *publiraadminv1.TenantCoinSettings) {
			s.Names = []*publiraadminv1.CoinNameTranslation{{Locale: "en", Name: "Points"}}
		}, field: "settings.names"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			settings := completeCoinSettings()
			tc.change(settings)
			_, err := f.save(settings)
			assertConnectCode(t, tc.name, err, connect.CodeInvalidArgument)
			assertBadRequestField(t, err, tc.field)
		})
	}

	_, err := f.save(completeCoinSettings())
	assertConnectCode(t, "no platform policy", err, connect.CodeFailedPrecondition)

	f.allowCoins(t, false)
	_, err = f.save(completeCoinSettings())
	assertConnectCode(t, "a policy forbidding coins", err, connect.CodeFailedPrecondition)

	f.allowCoins(t, true)
	_, err = f.save(completeCoinSettings())
	assertConnectCode(t, "no way to sell a pack", err, connect.CodeFailedPrecondition)
	if got := f.auditCount(t, "coin_settings_updated"); got != 0 {
		t.Fatalf("audit entries after refused saves = %d, want 0", got)
	}

	f.takePayments(t)
	saved, err := f.save(completeCoinSettings())
	if err != nil {
		t.Fatalf("turn coins on: %v", err)
	}
	if !saved.GetSettings().GetEnabled() || !saved.GetSettings().GetSelling() || !saved.GetPlatformAllowsCoins() {
		t.Fatalf("saved = %#v, want coins on and selling, and the platform allowing them", saved)
	}
	if got := f.auditCount(t, "coin_settings_updated"); got != 1 {
		t.Fatalf("audit entries = %d, want 1", got)
	}
}

// A tenant whose coins are on keeps saving them after the platform forbids
// coins: stopping selling, in particular, is never refused.
func TestDBUpdateTenantCoinSettingsStopsSellingWhateverThePolicy(t *testing.T) {
	f := newCoinFixture(t)
	f.allowCoins(t, true)
	f.takePayments(t)
	if _, err := f.save(completeCoinSettings()); err != nil {
		t.Fatalf("turn coins on: %v", err)
	}

	f.allowCoins(t, false)
	settings := completeCoinSettings()
	settings.Selling = false
	saved, err := f.save(settings)
	if err != nil {
		t.Fatalf("stop selling: %v", err)
	}
	if !saved.GetSettings().GetEnabled() || saved.GetSettings().GetSelling() {
		t.Fatalf("enabled, selling = %v, %v, want on and not selling", saved.GetSettings().GetEnabled(), saved.GetSettings().GetSelling())
	}

	settings.Enabled = false
	if _, err := f.save(settings); err != nil {
		t.Fatalf("turn coins off: %v", err)
	}
	settings.Enabled = true
	_, err = f.save(settings)
	assertConnectCode(t, "turning coins back on under a forbidding policy", err, connect.CodeFailedPrecondition)
}

// The names a save carries replace the stored ones, each locale's trimmed
// and checked, and a save that changes nothing is not audited.
func TestDBUpdateTenantCoinSettingsReplacesTheNames(t *testing.T) {
	f := newCoinFixture(t)
	if _, err := f.env.PG.DB.ExecContext(context.Background(), `UPDATE tenants SET supported_locales = ARRAY['ja', 'en'] WHERE id = $1`, f.admin.Tenant.ID); err != nil {
		t.Fatalf("narrow the offered locales: %v", err)
	}

	saved, err := f.save(&publiraadminv1.TenantCoinSettings{Names: []*publiraadminv1.CoinNameTranslation{
		{Locale: "ja", Name: "  Tickets  "},
		{Locale: "en", Name: "Points"},
	}})
	if err != nil {
		t.Fatalf("save two names: %v", err)
	}
	names := saved.GetSettings().GetNames()
	if len(names) != 2 || names[0].GetLocale() != "ja" || names[0].GetName() != "Tickets" || names[1].GetLocale() != "en" {
		t.Fatalf("names = %v, want ja Tickets then en Points", names)
	}

	if _, err := f.save(&publiraadminv1.TenantCoinSettings{Names: []*publiraadminv1.CoinNameTranslation{{Locale: "ja", Name: "Tickets"}}}); err != nil {
		t.Fatalf("save one name: %v", err)
	}
	if got := f.env.countRows(t, `SELECT count(*) FROM tenant_coin_name_translations WHERE tenant_id = $1`, f.admin.Tenant.ID); got != 1 {
		t.Fatalf("stored names = %d, want the en one removed", got)
	}
	if got := f.auditCount(t, "coin_settings_updated"); got != 2 {
		t.Fatalf("audit entries = %d, want 2", got)
	}
	if _, err := f.save(&publiraadminv1.TenantCoinSettings{Names: []*publiraadminv1.CoinNameTranslation{{Locale: "ja", Name: "Tickets"}}}); err != nil {
		t.Fatalf("save the same name again: %v", err)
	}
	if got := f.auditCount(t, "coin_settings_updated"); got != 2 {
		t.Fatalf("audit entries after an unchanged save = %d, want still 2", got)
	}

	for _, tc := range []struct {
		name  string
		names []*publiraadminv1.CoinNameTranslation
		field string
	}{
		{name: "a locale the tenant does not offer", names: []*publiraadminv1.CoinNameTranslation{{Locale: "ko", Name: "Points"}}, field: "settings.names[0].locale"},
		{name: "a locale named twice", names: []*publiraadminv1.CoinNameTranslation{{Locale: "ja", Name: "Tickets"}, {Locale: "ja", Name: "Points"}}, field: "settings.names[1].locale"},
		{name: "a blank name", names: []*publiraadminv1.CoinNameTranslation{{Locale: "ja", Name: " "}}, field: "settings.names[0].name"},
		{name: "a name past 30 code points", names: []*publiraadminv1.CoinNameTranslation{{Locale: "ja", Name: strings.Repeat("é", 31)}}, field: "settings.names[0].name"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := f.save(&publiraadminv1.TenantCoinSettings{Names: tc.names})
			assertConnectCode(t, tc.name, err, connect.CodeInvalidArgument)
			assertBadRequestField(t, err, tc.field)
		})
	}

	if _, err := f.save(&publiraadminv1.TenantCoinSettings{Names: []*publiraadminv1.CoinNameTranslation{{Locale: "ja", Name: strings.Repeat("é", 30)}}}); err != nil {
		t.Fatalf("a name of 30 code points: %v", err)
	}
}

func TestDBUpdateTenantCoinSettingsChecksTheDisclosures(t *testing.T) {
	f := newCoinFixture(t)

	for _, tc := range []struct {
		name   string
		change func(*publiraadminv1.TenantCoinSettings)
		field  string
	}{
		{name: "a negative coin value", change: func(s *publiraadminv1.TenantCoinSettings) { s.CoinUnitAmount = -1 }, field: "settings.coin_unit_amount"},
		{name: "an expiry past 100 years", change: func(s *publiraadminv1.TenantCoinSettings) { s.ExpiryDays = 36501 }, field: "settings.expiry_days"},
		{name: "a relative terms URL", change: func(s *publiraadminv1.TenantCoinSettings) { s.TermsUrl = "/coins/terms" }, field: "settings.terms_url"},
		{name: "a terms URL of another scheme", change: func(s *publiraadminv1.TenantCoinSettings) { s.TermsUrl = "javascript:alert(1)" }, field: "settings.terms_url"},
		{name: "a long issuer name", change: func(s *publiraadminv1.TenantCoinSettings) { s.IssuerName = strings.Repeat("a", 201) }, field: "settings.issuer_name"},
		{name: "a long contact", change: func(s *publiraadminv1.TenantCoinSettings) { s.Contact = strings.Repeat("a", 501) }, field: "settings.contact"},
		{name: "a long notice", change: func(s *publiraadminv1.TenantCoinSettings) { s.Notice = strings.Repeat("a", 2001) }, field: "settings.notice"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			settings := completeCoinSettings()
			settings.Enabled = false
			tc.change(settings)
			_, err := f.save(settings)
			assertConnectCode(t, tc.name, err, connect.CodeInvalidArgument)
			assertBadRequestField(t, err, tc.field)
		})
	}

	_, err := f.env.coinClient().UpdateTenantCoinSettings(f.ctx(), &publiraadminv1.UpdateTenantCoinSettingsRequest{
		Tenant:   f.admin.tenantContext(),
		Settings: &publiraadminv1.TenantCoinSettings{CoinUnitAmount: 10},
		Currency: f.otherCurrency(t),
	})
	assertConnectCode(t, "a coin value in another currency", err, connect.CodeFailedPrecondition)
	assertBadRequestField(t, err, "currency")
}

// An editor and an auditor read the settings and the packs, and change
// neither.
func TestDBCoinSettingsAreReadByEveryRoleAndWrittenByAnAdmin(t *testing.T) {
	f := newCoinFixture(t)
	editor := f.admin.as(f.env.PG.SeedTenantUser(t, f.admin.Tenant.ID, "TAEDITOR01", "editor@tenant-a.example.com", "Tenant A Editor", auth.RoleTenantEditor))
	ctx := testutil.WithBearer(context.Background(), editor.token())

	if _, err := f.env.coinClient().GetTenantCoinSettings(ctx, &publiraadminv1.GetTenantCoinSettingsRequest{Tenant: editor.tenantContext()}); err != nil {
		t.Fatalf("an editor reads the settings: %v", err)
	}
	if _, err := f.env.coinClient().ListCoinPacks(ctx, &publiraadminv1.ListCoinPacksRequest{Tenant: editor.tenantContext()}); err != nil {
		t.Fatalf("an editor lists the packs: %v", err)
	}
	_, err := f.env.coinClient().UpdateTenantCoinSettings(ctx, &publiraadminv1.UpdateTenantCoinSettingsRequest{Tenant: editor.tenantContext(), Settings: &publiraadminv1.TenantCoinSettings{}})
	assertConnectCode(t, "an editor saving the settings", err, connect.CodePermissionDenied)
	_, err = f.env.coinClient().CreateCoinPack(ctx, &publiraadminv1.CreateCoinPackRequest{Tenant: editor.tenantContext(), Pack: &publiraadminv1.CoinPackInput{Coins: 100, Price: 100}})
	assertConnectCode(t, "an editor creating a pack", err, connect.CodePermissionDenied)
}

func (f *coinFixture) createPack(t *testing.T, pack *publiraadminv1.CoinPackInput) *publiraadminv1.CoinPack {
	t.Helper()

	created, err := f.env.coinClient().CreateCoinPack(f.ctx(), &publiraadminv1.CreateCoinPackRequest{Tenant: f.admin.tenantContext(), Pack: pack})
	if err != nil {
		t.Fatalf("CreateCoinPack: %v", err)
	}
	return created.GetPack()
}

func (f *coinFixture) updatePack(id string, pack *publiraadminv1.CoinPackInput) (*publiraadminv1.CoinPack, error) {
	updated, err := f.env.coinClient().UpdateCoinPack(f.ctx(), &publiraadminv1.UpdateCoinPackRequest{Tenant: f.admin.tenantContext(), CoinPackId: id, Pack: pack})
	return updated.GetPack(), err
}

func (f *coinFixture) listPacks(t *testing.T) []*publiraadminv1.CoinPack {
	t.Helper()

	listed, err := f.env.coinClient().ListCoinPacks(f.ctx(), &publiraadminv1.ListCoinPacksRequest{Tenant: f.admin.tenantContext()})
	if err != nil {
		t.Fatalf("ListCoinPacks: %v", err)
	}
	return listed.GetPacks()
}

// Packs are listed in their sort order, a retired one leaves the list, and
// each write is in the audit log.
func TestDBCoinPacksAreCreatedOrderedAndRetired(t *testing.T) {
	f := newCoinFixture(t)

	large := f.createPack(t, &publiraadminv1.CoinPackInput{Coins: 1000, BonusCoins: 100, Price: 1000, SortOrder: 2, OnSale: true})
	small := f.createPack(t, &publiraadminv1.CoinPackInput{Coins: 100, Price: 100, SortOrder: 1, OnSale: true})
	if large.GetPublicId() == "" || large.GetSold() || large.GetCurrency() == "" {
		t.Fatalf("created pack = %#v, want a public ID, unsold, in the tenant currency", large)
	}

	packs := f.listPacks(t)
	if len(packs) != 2 || packs[0].GetId() != small.GetId() || packs[1].GetId() != large.GetId() {
		t.Fatalf("packs = %v, want the small pack then the large one", packs)
	}

	updated, err := f.updatePack(small.GetId(), &publiraadminv1.CoinPackInput{Coins: 120, Price: 100, SortOrder: 3, OnSale: true})
	if err != nil {
		t.Fatalf("update an unsold pack: %v", err)
	}
	if updated.GetCoins() != 120 || updated.GetSortOrder() != 3 {
		t.Fatalf("updated pack = %#v, want 120 coins at sort order 3", updated)
	}

	if _, err := f.env.coinClient().RetireCoinPack(f.ctx(), &publiraadminv1.RetireCoinPackRequest{Tenant: f.admin.tenantContext(), CoinPackId: large.GetId()}); err != nil {
		t.Fatalf("RetireCoinPack: %v", err)
	}
	if packs := f.listPacks(t); len(packs) != 1 || packs[0].GetId() != small.GetId() {
		t.Fatalf("packs after retiring = %v, want the small pack alone", packs)
	}
	if got := f.env.countRows(t, `SELECT count(*) FROM tenant_coin_packs WHERE id = $1 AND retired_at IS NOT NULL AND NOT on_sale`, large.GetId()); got != 1 {
		t.Fatal("the retired pack is not kept, off sale")
	}
	_, err = f.updatePack(large.GetId(), &publiraadminv1.CoinPackInput{Coins: 1000, BonusCoins: 100, Price: 1000, OnSale: true})
	assertConnectCode(t, "updating a retired pack", err, connect.CodeNotFound)
	_, err = f.env.coinClient().RetireCoinPack(f.ctx(), &publiraadminv1.RetireCoinPackRequest{Tenant: f.admin.tenantContext(), CoinPackId: large.GetId()})
	assertConnectCode(t, "retiring a pack twice", err, connect.CodeNotFound)

	for action, want := range map[string]int{"coin_pack_created": 2, "coin_pack_updated": 1, "coin_pack_retired": 1} {
		if got := f.auditCount(t, action); got != want {
			t.Fatalf("%s entries = %d, want %d", action, got, want)
		}
	}
}

// A sold pack keeps its price and coins: only its sale state and its order
// change.
func TestDBUpdateCoinPackKeepsASoldPacksTerms(t *testing.T) {
	f := newCoinFixture(t)
	pack := f.createPack(t, &publiraadminv1.CoinPackInput{Coins: 100, BonusCoins: 10, Price: 100, SortOrder: 1, OnSale: true})
	if _, err := f.env.PG.DB.ExecContext(context.Background(), `UPDATE tenant_coin_packs SET first_sold_at = now() WHERE id = $1`, pack.GetId()); err != nil {
		t.Fatalf("record a sale of the pack: %v", err)
	}

	for _, tc := range []struct {
		name  string
		input *publiraadminv1.CoinPackInput
	}{
		{name: "price", input: &publiraadminv1.CoinPackInput{Coins: 100, BonusCoins: 10, Price: 120, SortOrder: 1, OnSale: true}},
		{name: "coins", input: &publiraadminv1.CoinPackInput{Coins: 120, BonusCoins: 10, Price: 100, SortOrder: 1, OnSale: true}},
		{name: "bonus coins", input: &publiraadminv1.CoinPackInput{Coins: 100, BonusCoins: 20, Price: 100, SortOrder: 1, OnSale: true}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := f.updatePack(pack.GetId(), tc.input)
			assertConnectCode(t, tc.name, err, connect.CodeFailedPrecondition)
			if got := errorInfoReason(t, err); got != rpcerrors.ReasonCoinPackSold {
				t.Fatalf("reason = %q, want %q", got, rpcerrors.ReasonCoinPackSold)
			}
		})
	}

	updated, err := f.updatePack(pack.GetId(), &publiraadminv1.CoinPackInput{Coins: 100, BonusCoins: 10, Price: 100, SortOrder: 5, OnSale: false})
	if err != nil {
		t.Fatalf("change a sold pack's sale state and order: %v", err)
	}
	if !updated.GetSold() || updated.GetOnSale() || updated.GetSortOrder() != 5 {
		t.Fatalf("updated pack = %#v, want sold, off sale, at sort order 5", updated)
	}
}

func TestDBCreateCoinPackChecksItsFields(t *testing.T) {
	f := newCoinFixture(t)

	for _, tc := range []struct {
		name  string
		input *publiraadminv1.CoinPackInput
		field string
	}{
		{name: "no coins", input: &publiraadminv1.CoinPackInput{Price: 100}, field: "pack.coins"},
		{name: "negative bonus coins", input: &publiraadminv1.CoinPackInput{Coins: 100, BonusCoins: -1, Price: 100}, field: "pack.bonus_coins"},
		{name: "coins past an int32 together", input: &publiraadminv1.CoinPackInput{Coins: 2147483647, BonusCoins: 1, Price: 100}, field: "pack.bonus_coins"},
		{name: "no price", input: &publiraadminv1.CoinPackInput{Coins: 100}, field: "pack.price"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := f.env.coinClient().CreateCoinPack(f.ctx(), &publiraadminv1.CreateCoinPackRequest{Tenant: f.admin.tenantContext(), Pack: tc.input})
			assertConnectCode(t, tc.name, err, connect.CodeInvalidArgument)
			assertBadRequestField(t, err, tc.field)
		})
	}

	_, err := f.env.coinClient().CreateCoinPack(f.ctx(), &publiraadminv1.CreateCoinPackRequest{Tenant: f.admin.tenantContext(), Pack: &publiraadminv1.CoinPackInput{Coins: 100, Price: 100, Currency: f.otherCurrency(t)}})
	assertConnectCode(t, "a price in another currency", err, connect.CodeFailedPrecondition)
	assertBadRequestField(t, err, "pack.currency")
}

// A tenant sells at most maxCoinPacks packs at once; retiring one makes room.
func TestDBCreateCoinPackRefusesPastTheCap(t *testing.T) {
	f := newCoinFixture(t)

	var first *publiraadminv1.CoinPack
	for i := range maxCoinPacks {
		pack := f.createPack(t, &publiraadminv1.CoinPackInput{Coins: int32(100 + i), Price: 100, SortOrder: int32(i)})
		if first == nil {
			first = pack
		}
	}
	_, err := f.env.coinClient().CreateCoinPack(f.ctx(), &publiraadminv1.CreateCoinPackRequest{Tenant: f.admin.tenantContext(), Pack: &publiraadminv1.CoinPackInput{Coins: 100, Price: 100}})
	assertConnectCode(t, "a pack past the cap", err, connect.CodeFailedPrecondition)
	if got := errorInfoReason(t, err); got != rpcerrors.ReasonCoinPackLimit {
		t.Fatalf("reason = %q, want %q", got, rpcerrors.ReasonCoinPackLimit)
	}

	if _, err := f.env.coinClient().RetireCoinPack(f.ctx(), &publiraadminv1.RetireCoinPackRequest{Tenant: f.admin.tenantContext(), CoinPackId: first.GetId()}); err != nil {
		t.Fatalf("RetireCoinPack: %v", err)
	}
	f.createPack(t, &publiraadminv1.CoinPackInput{Coins: 100, Price: 100})
}

// errorInfoMetadata reads the metadata of the Publira ErrorInfo an error
// carries, or nil when it carries none.
func errorInfoMetadata(t *testing.T, err error) map[string]string {
	t.Helper()

	var connectErr *connect.Error
	if !errors.As(err, &connectErr) {
		t.Fatalf("error is not a connect error: %v", err)
	}
	for _, detail := range connectErr.Details() {
		value, valueErr := connectproto.UnmarshalErrorDetail(detail)
		if valueErr != nil {
			continue
		}
		if info, ok := value.(*errdetails.ErrorInfo); ok && info.GetDomain() == rpcerrors.ErrorInfoDomain {
			return info.GetMetadata()
		}
	}
	return nil
}

// Readers who hold coins keep the tenant's coins on, and once a coin has been
// granted what one is worth stays fixed. Stopping selling is never refused.
func TestDBUpdateTenantCoinSettingsKeepsWhatBalancesAreCountedIn(t *testing.T) {
	f := newCoinFixture(t)
	f.allowCoins(t, true)
	f.takePayments(t)
	if _, err := f.save(completeCoinSettings()); err != nil {
		t.Fatalf("turn coins on: %v", err)
	}
	tenantID := f.admin.Tenant.ID
	first := f.env.PG.SeedEndUser(t, tenantID, "COINREADER01", "first@tenant-a.example.com", "First reader")
	second := f.env.PG.SeedEndUser(t, tenantID, "COINREADER02", "second@tenant-a.example.com", "Second reader")
	lapsed := f.env.PG.SeedEndUser(t, tenantID, "COINREADER03", "lapsed@tenant-a.example.com", "Lapsed reader")
	f.env.PG.SeedCoinGrant(t, tenantID, first.ID, 10, time.Now().Add(30*24*time.Hour))
	f.env.PG.SeedCoinGrant(t, tenantID, second.ID, 5, time.Now().Add(30*24*time.Hour))
	f.env.PG.SeedCoinGrant(t, tenantID, second.ID, 5, time.Now().Add(60*24*time.Hour))
	f.env.PG.SeedCoinGrant(t, tenantID, lapsed.ID, 5, time.Now().Add(-time.Hour))

	off := completeCoinSettings()
	off.Enabled = false
	_, err := f.save(off)
	assertConnectCode(t, "turning coins off with balances held", err, connect.CodeFailedPrecondition)
	if got := errorInfoReason(t, err); got != rpcerrors.ReasonCoinBalancesOutstanding {
		t.Fatalf("reason = %q, want %q", got, rpcerrors.ReasonCoinBalancesOutstanding)
	}
	if got := errorInfoMetadata(t, err)[rpcerrors.MetadataReaderCount]; got != "2" {
		t.Fatalf("reader_count = %q, want 2: the reader whose coins expired holds none", got)
	}

	revalued := completeCoinSettings()
	revalued.CoinUnitAmount = 2
	_, err = f.save(revalued)
	assertConnectCode(t, "changing coin_unit_amount after a grant", err, connect.CodeFailedPrecondition)
	if got := errorInfoReason(t, err); got != rpcerrors.ReasonCoinUnitAmountFixed {
		t.Fatalf("reason = %q, want %q", got, rpcerrors.ReasonCoinUnitAmountFixed)
	}

	notSelling := completeCoinSettings()
	notSelling.Selling = false
	if _, err := f.save(notSelling); err != nil {
		t.Fatalf("stop selling with balances held: %v", err)
	}

	if _, err := f.env.PG.DB.ExecContext(context.Background(), `UPDATE coin_grants SET remaining_coins = 0 WHERE tenant_id = $1`, tenantID); err != nil {
		t.Fatalf("spend every balance: %v", err)
	}
	notSelling.Enabled = false
	if _, err := f.save(notSelling); err != nil {
		t.Fatalf("turn coins off once no balance is held: %v", err)
	}
	notSelling.CoinUnitAmount = 2
	_, err = f.save(notSelling)
	assertConnectCode(t, "changing coin_unit_amount after every grant is spent", err, connect.CodeFailedPrecondition)
	if got := f.auditCount(t, "coin_settings_updated"); got != 3 {
		t.Fatalf("audit entries = %d, want the three saves that went through", got)
	}
}

// The storefront prices episodes in coins and names them, so a save that
// changes the settings drops the cached series and episode reads, and one that
// changes nothing drops nothing.
func TestDBUpdateTenantCoinSettingsDropsTheCachedEpisodePrices(t *testing.T) {
	env := newReaderIconDBEnv(t)
	f := &coinFixture{env: env, admin: env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAADMIN01", "admin@tenant-a.example.com")}
	f.allowCoins(t, true)
	f.takePayments(t)
	env.takeRevalidatedTags(t, f.admin.Tenant)
	want := []string{"tenant:" + f.admin.Tenant.ID.String() + ":series:detail"}

	if _, err := f.save(completeCoinSettings()); err != nil {
		t.Fatalf("turn coins on: %v", err)
	}
	if got := env.takeRevalidatedTags(t, f.admin.Tenant); !slices.Equal(got, want) {
		t.Fatalf("invalidations recorded by a change = %v, want %v", got, want)
	}
	if _, err := f.save(completeCoinSettings()); err != nil {
		t.Fatalf("save the same settings again: %v", err)
	}
	if got := env.takeRevalidatedTags(t, f.admin.Tenant); len(got) != 0 {
		t.Fatalf("invalidations recorded by an unchanged save = %v, want none", got)
	}
}

// The storefront reads the packs on sale with the coin settings, so every pack
// write that changes what readers are offered drops that read, and an update
// that stores nothing new drops nothing.
func TestDBCoinPackWritesDropTheCachedCoins(t *testing.T) {
	env := newReaderIconDBEnv(t)
	f := &coinFixture{env: env, admin: env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAADMIN01", "admin@tenant-a.example.com")}
	want := []string{"tenant:" + f.admin.Tenant.ID.String() + ":series:detail"}
	env.takeRevalidatedTags(t, f.admin.Tenant)

	pack := f.createPack(t, &publiraadminv1.CoinPackInput{Coins: 100, BonusCoins: 10, Price: 100, SortOrder: 1, OnSale: true})
	if got := env.takeRevalidatedTags(t, f.admin.Tenant); !slices.Equal(got, want) {
		t.Fatalf("invalidations recorded by a create = %v, want %v", got, want)
	}

	if _, err := f.updatePack(pack.GetId(), &publiraadminv1.CoinPackInput{Coins: 100, BonusCoins: 10, Price: 100, SortOrder: 1, OnSale: true}); err != nil {
		t.Fatalf("save the same pack again: %v", err)
	}
	if got := env.takeRevalidatedTags(t, f.admin.Tenant); len(got) != 0 {
		t.Fatalf("invalidations recorded by an unchanged update = %v, want none", got)
	}

	for _, tc := range []struct {
		name  string
		input *publiraadminv1.CoinPackInput
	}{
		{name: "price", input: &publiraadminv1.CoinPackInput{Coins: 100, BonusCoins: 10, Price: 120, SortOrder: 1, OnSale: true}},
		{name: "coins", input: &publiraadminv1.CoinPackInput{Coins: 120, BonusCoins: 10, Price: 120, SortOrder: 1, OnSale: true}},
		{name: "bonus coins", input: &publiraadminv1.CoinPackInput{Coins: 120, BonusCoins: 20, Price: 120, SortOrder: 1, OnSale: true}},
		{name: "sale state", input: &publiraadminv1.CoinPackInput{Coins: 120, BonusCoins: 20, Price: 120, SortOrder: 1, OnSale: false}},
		{name: "position", input: &publiraadminv1.CoinPackInput{Coins: 120, BonusCoins: 20, Price: 120, SortOrder: 2, OnSale: false}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := f.updatePack(pack.GetId(), tc.input); err != nil {
				t.Fatalf("UpdateCoinPack: %v", err)
			}
			if got := env.takeRevalidatedTags(t, f.admin.Tenant); !slices.Equal(got, want) {
				t.Fatalf("invalidations recorded by a change to the %s = %v, want %v", tc.name, got, want)
			}
		})
	}

	if _, err := env.coinClient().RetireCoinPack(f.ctx(), &publiraadminv1.RetireCoinPackRequest{Tenant: f.admin.tenantContext(), CoinPackId: pack.GetId()}); err != nil {
		t.Fatalf("RetireCoinPack: %v", err)
	}
	if got := env.takeRevalidatedTags(t, f.admin.Tenant); !slices.Equal(got, want) {
		t.Fatalf("invalidations recorded by a retire = %v, want %v", got, want)
	}
}
