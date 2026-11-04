package adminapi

import (
	"context"
	"database/sql"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// setTaxRateSince records a change of the tenant's rate applying from an
// instant in the past, which the console cannot do, so that sales seeded
// across a month fall on both sides of it.
func (e *adminDBEnv) setTaxRateSince(t *testing.T, tenant adminDBTenant, rateBps sql.NullInt32, since time.Time) {
	t.Helper()
	if _, err := e.PG.DB.ExecContext(context.Background(),
		"INSERT INTO tenant_tax_rates (tenant_id, applies_from, rate_bps) VALUES ($1, $2, $3)",
		tenant.Tenant.ID, since, rateBps); err != nil {
		t.Fatalf("set the tax rate of %s since %s: %v", tenant.Tenant.PublicID, since.Format(time.RFC3339), err)
	}
}

// setWithholdingRate stands in for a Tenant admin saving a withholding rate.
func (e *adminDBEnv) setWithholdingRate(t *testing.T, tenant adminDBTenant, rateBps int32) {
	t.Helper()
	if _, err := e.PG.DB.ExecContext(context.Background(), `
		INSERT INTO tenant_config (tenant_id, withholding_rate_bps) VALUES ($1, $2)
		ON CONFLICT (tenant_id) DO UPDATE SET withholding_rate_bps = EXCLUDED.withholding_rate_bps
	`, tenant.Tenant.ID, rateBps); err != nil {
		t.Fatalf("set the withholding rate of %s: %v", tenant.Tenant.PublicID, err)
	}
}

// purchaseTax reads the rate and the tax a purchase recorded.
func (e *adminDBEnv) purchaseTax(t *testing.T, purchaseID uuid.UUID) (sql.NullInt32, sql.NullInt32) {
	t.Helper()
	var rate, tax sql.NullInt32
	if err := e.PG.DB.QueryRowContext(context.Background(),
		"SELECT tax_rate_bps, tax_amount FROM purchases WHERE id = $1", purchaseID).Scan(&rate, &tax); err != nil {
		t.Fatalf("read the tax of purchase %s: %v", purchaseID, err)
	}
	return rate, tax
}

// sellNow records a sale at the database's own clock, as a payment
// notification does.
func (e *adminDBEnv) sellNow(t *testing.T, f royaltyFixture, price int32) uuid.UUID {
	t.Helper()
	id := uuid.Must(uuid.NewV7())
	if _, err := e.PG.DB.ExecContext(context.Background(), `
		INSERT INTO purchases (id, tenant_id, user_id, episode_id, price_at_purchase, currency)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, id, f.admin.Tenant.ID, f.reader.ID, f.episode.ID, price, e.PG.TenantCurrency(t, f.admin.Tenant.ID)); err != nil {
		t.Fatalf("sell episode %s now: %v", f.episode.ID, err)
	}
	return id
}

// A rate applies from the moment it is saved: a purchase recorded after it
// records the tax its price includes, rounded as the price less the price
// without tax rounded down, and one made before keeps none. A change to no
// rate stops the recording again, and the settings read back what was saved.
func TestDBTenantTaxSettingsRecordTheTaxOfPurchasesMadeAfterThem(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	f := env.seedRoyaltyFixture(t, "TXS")
	ctx := testutil.WithBearer(context.Background(), f.admin.token())
	client := env.tenantSettingsClient()

	initial, err := client.GetTenantTaxSettings(ctx, &publiraadminv1.GetTenantTaxSettingsRequest{Tenant: f.admin.tenantContext()})
	if err != nil {
		t.Fatalf("GetTenantTaxSettings: %v", err)
	}
	if initial.Settings.TaxRate != nil || initial.Settings.WithholdingRateBps != nil ||
		initial.Settings.InvoiceLegalName != "" || initial.Settings.InvoiceRegistrationNumber != "" {
		t.Fatalf("settings of a tenant that saved none = %+v, want none", initial.Settings)
	}

	before := env.sellNow(t, f, 1100)
	saved, err := client.UpdateTenantTaxSettings(ctx, &publiraadminv1.UpdateTenantTaxSettingsRequest{
		Tenant:                    f.admin.tenantContext(),
		TaxRateBps:                new(int32(1000)),
		WithholdingRateBps:        new(int32(1021)),
		InvoiceLegalName:          "  Tax Settings Ltd.  ",
		InvoiceRegistrationNumber: "T1234567890123",
	})
	if err != nil {
		t.Fatalf("UpdateTenantTaxSettings: %v", err)
	}
	if saved.Settings.TaxRate == nil || saved.Settings.TaxRate.GetRateBps() != 1000 || saved.Settings.TaxRate.AppliesFrom == "" ||
		saved.Settings.GetWithholdingRateBps() != 1021 || saved.Settings.InvoiceLegalName != "Tax Settings Ltd." ||
		saved.Settings.InvoiceRegistrationNumber != "T1234567890123" {
		t.Fatalf("saved settings = %+v, want 10%%, 10.21%% withheld, and the trimmed invoice details", saved.Settings)
	}
	read, err := client.GetTenantTaxSettings(ctx, &publiraadminv1.GetTenantTaxSettingsRequest{Tenant: f.admin.tenantContext()})
	if err != nil {
		t.Fatalf("GetTenantTaxSettings after a save: %v", err)
	}
	if read.Settings.TaxRate.GetRateBps() != 1000 || read.Settings.TaxRate.AppliesFrom != saved.Settings.TaxRate.AppliesFrom {
		t.Fatalf("read rate = %+v, want the saved one %+v", read.Settings.TaxRate, saved.Settings.TaxRate)
	}

	if rate, tax := env.purchaseTax(t, before); rate.Valid || tax.Valid {
		t.Fatalf("purchase made before the rate recorded %v and %v, want none", rate, tax)
	}
	after := env.sellNow(t, f, 1100)
	if rate, tax := env.purchaseTax(t, after); rate.Int32 != 1000 || tax.Int32 != 100 {
		t.Fatalf("purchase of 1100 after a 10%% rate recorded rate %v and tax %v, want 1000 and 100", rate, tax)
	}
	// 105 without its tax is 95.45, rounded down to 95.
	odd := env.sellNow(t, f, 105)
	if _, tax := env.purchaseTax(t, odd); tax.Int32 != 10 {
		t.Fatalf("tax of 105 at 10%% = %v, want 10", tax)
	}

	// The same rate saved again is no change of it.
	if _, err := client.UpdateTenantTaxSettings(ctx, &publiraadminv1.UpdateTenantTaxSettingsRequest{
		Tenant:                    f.admin.tenantContext(),
		TaxRateBps:                new(int32(1000)),
		WithholdingRateBps:        new(int32(1021)),
		InvoiceLegalName:          "Tax Settings Ltd.",
		InvoiceRegistrationNumber: "T1234567890123",
	}); err != nil {
		t.Fatalf("UpdateTenantTaxSettings with the same values: %v", err)
	}
	if got := env.countRows(t, "SELECT count(*) FROM tenant_tax_rates WHERE tenant_id = $1", f.admin.Tenant.ID); got != 1 {
		t.Fatalf("rate changes after saving the same rate twice = %d, want 1", got)
	}
	if got := tenantSettingAuditCount(t, env, f.admin, "tenant_tax_settings_updated", "tenant_tax_settings"); got != 1 {
		t.Fatalf("audit entries after saving the same settings twice = %d, want 1", got)
	}

	cleared, err := client.UpdateTenantTaxSettings(ctx, &publiraadminv1.UpdateTenantTaxSettingsRequest{Tenant: f.admin.tenantContext()})
	if err != nil {
		t.Fatalf("UpdateTenantTaxSettings clearing everything: %v", err)
	}
	if cleared.Settings.TaxRate == nil || cleared.Settings.TaxRate.RateBps != nil || cleared.Settings.WithholdingRateBps != nil ||
		cleared.Settings.InvoiceLegalName != "" || cleared.Settings.InvoiceRegistrationNumber != "" {
		t.Fatalf("cleared settings = %+v, want a change to no rate and nothing else", cleared.Settings)
	}
	if rate, tax := env.purchaseTax(t, env.sellNow(t, f, 1100)); rate.Valid || tax.Valid {
		t.Fatalf("purchase made after the rate was cleared recorded %v and %v, want none", rate, tax)
	}
	if rate, tax := env.purchaseTax(t, after); rate.Int32 != 1000 || tax.Int32 != 100 {
		t.Fatalf("purchase made at 10%% reads %v and %v after the rate was cleared, want it kept", rate, tax)
	}
}

func TestDBTenantTaxSettingsRefuseWhatAReceiptCannotPrint(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TAXVALT1", "tax-validation.example.com", "Tax Validation", "TAXVALU1", "admin@tax-validation.example.com")
	ctx := testutil.WithBearer(context.Background(), tenant.token())

	for _, testCase := range []struct {
		name string
		req  *publiraadminv1.UpdateTenantTaxSettingsRequest
	}{
		{name: "a rate of nothing", req: &publiraadminv1.UpdateTenantTaxSettingsRequest{TaxRateBps: new(int32(0))}},
		{name: "a rate above all of the price", req: &publiraadminv1.UpdateTenantTaxSettingsRequest{TaxRateBps: new(int32(10001))}},
		{name: "a negative withholding rate", req: &publiraadminv1.UpdateTenantTaxSettingsRequest{WithholdingRateBps: new(int32(-1))}},
		{name: "a registration number with a space", req: &publiraadminv1.UpdateTenantTaxSettingsRequest{InvoiceRegistrationNumber: "T1234 567890123"}},
		{name: "a registration number of prose", req: &publiraadminv1.UpdateTenantTaxSettingsRequest{InvoiceRegistrationNumber: strings.Repeat("T", 33)}},
		{name: "a legal name over two lines", req: &publiraadminv1.UpdateTenantTaxSettingsRequest{InvoiceLegalName: "Tax\nValidation"}},
		{name: "a legal name too long", req: &publiraadminv1.UpdateTenantTaxSettingsRequest{InvoiceLegalName: strings.Repeat("名", 201)}},
	} {
		testCase.req.Tenant = tenant.tenantContext()
		if _, err := env.tenantSettingsClient().UpdateTenantTaxSettings(ctx, testCase.req); connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Errorf("%s: code = %v, want invalid_argument", testCase.name, connect.CodeOf(err))
		}
	}
	if got := env.countRows(t, "SELECT count(*) FROM tenant_tax_rates WHERE tenant_id = $1", tenant.Tenant.ID); got != 0 {
		t.Fatalf("rate changes after refused saves = %d, want 0", got)
	}
}

// A month whose rate changed has a line per rate for each credit, the sales
// made without a rate first. Each line states the tax its payout includes,
// each Author's subtotal the tax and what the tenant's withholding rate at
// close takes from the payout less that tax, and the statement keeps the rate
// it withheld at after the tenant changes it.
func TestDBAdminRoyaltyStatementStatesTaxAndWithholding(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	f := env.seedRoyaltyFixture(t, "RTX")
	artist := env.PG.SeedCreator(t, f.admin.Tenant.ID, testutil.CreatorSeed{PublicID: "RTXARTIST001", Name: "Artist Person"})
	author := env.PG.SeedCreator(t, f.admin.Tenant.ID, testutil.CreatorSeed{PublicID: "RTXAUTHOR001", Name: "Author Person"})
	env.creditEpisode(t, f.admin.Tenant.ID, f.episode.ID, artist.ID, "Artist", "series", 3000)
	env.creditEpisode(t, f.admin.Tenant.ID, f.episode.ID, author.ID, "Original Author", "series", 2000)

	env.seedSale(t, f, f.episode.ID, royaltySale{price: 500, purchasedAt: inRoyaltyZone(2026, time.July, 10, 12, 0, 0)})
	env.setTaxRateSince(t, f.admin, sql.NullInt32{Int32: 1000, Valid: true}, inRoyaltyZone(2026, time.July, 15, 0, 0, 0))
	refunded := env.seedSale(t, f, f.episode.ID, royaltySale{price: 1100, purchasedAt: inRoyaltyZone(2026, time.July, 20, 12, 0, 0)})
	env.seedSale(t, f, f.episode.ID, royaltySale{price: 1100, purchasedAt: inRoyaltyZone(2026, time.July, 21, 12, 0, 0)})
	env.setWithholdingRate(t, f.admin, 1021)

	type taxedLine struct {
		creator string
		rate    *int32
		gross   int64
		payout  int64
		tax     *int64
	}
	lineOf := func(line *publiraadminv1.RoyaltyStatementLine) taxedLine {
		return taxedLine{line.CreatorName, line.TaxRateBps, line.GrossAmount, line.PayoutAmount, line.TaxAmount}
	}
	// 660 without its tax is 600, and 440 without it 400.
	want := []taxedLine{
		{creator: "Artist Person", gross: 500, payout: 150},
		{creator: "Artist Person", rate: new(int32(1000)), gross: 2200, payout: 660, tax: new(int64(60))},
		{creator: "Author Person", gross: 500, payout: 100},
		{creator: "Author Person", rate: new(int32(1000)), gross: 2200, payout: 440, tax: new(int64(40))},
	}
	assertLines := func(label string, lines []*publiraadminv1.RoyaltyStatementLine) {
		t.Helper()
		if len(lines) != len(want) {
			t.Fatalf("%s lines = %d, want %d", label, len(lines), len(want))
		}
		for i, line := range lines {
			got := lineOf(line)
			if got.creator != want[i].creator || got.gross != want[i].gross || got.payout != want[i].payout ||
				!equalOptional(got.rate, want[i].rate) || !equalOptional(got.tax, want[i].tax) {
				t.Fatalf("%s line %d = %s %v %d %d %v, want %+v", label, i+1, got.creator, deref(got.rate), got.gross, got.payout, deref(got.tax), want[i])
			}
		}
	}
	// (810 - 60) * 10.21% is 76.575, and (540 - 40) * 10.21% is 51.05.
	wantSubtotals := []struct {
		creator     string
		payout      int64
		tax         int64
		withholding int64
	}{
		{"Artist Person", 810, 60, 76},
		{"Author Person", 540, 40, 51},
	}
	assertSubtotals := func(label string, subtotals []*publiraadminv1.RoyaltyCreatorSubtotal) {
		t.Helper()
		if len(subtotals) != len(wantSubtotals) {
			t.Fatalf("%s subtotals = %d, want %d", label, len(subtotals), len(wantSubtotals))
		}
		for i, subtotal := range subtotals {
			w := wantSubtotals[i]
			if subtotal.CreatorName != w.creator || subtotal.PayoutAmount != w.payout ||
				subtotal.GetTaxAmount() != w.tax || subtotal.TaxAmount == nil ||
				subtotal.GetWithholdingAmount() != w.withholding || subtotal.WithholdingAmount == nil {
				t.Fatalf("%s subtotal %d = %+v, want %+v", label, i+1, subtotal, w)
			}
		}
	}
	assertTotals := func(label string, totals *publiraadminv1.RoyaltyStatementTotals) {
		t.Helper()
		if totals.Payout != 1350 || totals.Tax == nil || totals.GetTax() != 100 || totals.Withholding == nil || totals.GetWithholding() != 127 {
			t.Fatalf("%s totals = %+v, want payout 1350, tax 100, withholding 127", label, totals)
		}
	}

	preview := env.previewRoyalties(t, f.admin, "2026-07")
	assertLines("preview", preview.Lines)
	assertSubtotals("preview", preview.CreatorSubtotals)
	assertTotals("preview", preview.Totals)
	if preview.GetWithholdingRateBps() != 1021 {
		t.Fatalf("preview withholding rate = %v, want 1021", preview.WithholdingRateBps)
	}

	statement := env.closeRoyalties(t, f.admin, "2026-07")
	assertTotals("closed statement", statement.Totals)
	env.setWithholdingRate(t, f.admin, 2042)
	closed := env.getRoyalties(t, f.admin, &publiraadminv1.GetRoyaltyStatementRequest{Period: "2026-07"})
	assertLines("closed statement", closed.Lines)
	assertSubtotals("closed statement", closed.CreatorSubtotals)
	assertTotals("closed statement", closed.Statement.Totals)
	if closed.Statement.GetWithholdingRateBps() != 1021 {
		t.Fatalf("closed withholding rate after the tenant changed it = %v, want 1021", closed.Statement.WithholdingRateBps)
	}

	currency := env.PG.TenantCurrency(t, f.admin.Tenant.ID)
	role := env.PG.CreatorRoleByName(t, f.admin.Tenant.ID, "Artist")
	authorRole := env.PG.CreatorRoleByName(t, f.admin.Tenant.ID, "Original Author")
	line := func(creatorID uuid.UUID, creatorName, roleID, roleName, gross, share, payout, rate, tax string) string {
		return "2026-07," + creatorID.String() + "," + creatorName + "," + roleID + "," + roleName + "," +
			f.series.ID.String() + ",Royalty Series," + f.episode.ID.String() + ",Episode 1," +
			map[string]string{"500": "1", "2200": "2"}[gross] + "," + gross + ",0," + share + "," + payout + "," + currency + ",,sale,line," + rate + "," + tax + ",\r\n"
	}
	wantCSV := "\xEF\xBB\xBF" +
		"period,creator_id,creator_name,role_id,role_name,series_id,series_title,episode_id,episode_title,sale_count,gross_amount,refunded_amount,share_percent,payout_amount,currency,adjusted_period,source,row_type,tax_rate_percent,tax_amount,withholding_amount\r\n" +
		line(artist.ID, "Artist Person", role.ID.String(), "Artist", "500", "30.00", "150", "", "") +
		line(artist.ID, "Artist Person", role.ID.String(), "Artist", "2200", "30.00", "660", "10.00", "60") +
		line(author.ID, "Author Person", authorRole.ID.String(), "Original Author", "500", "20.00", "100", "", "") +
		line(author.ID, "Author Person", authorRole.ID.String(), "Original Author", "2200", "20.00", "440", "10.00", "40") +
		"2026-07," + artist.ID.String() + ",Artist Person,,,,,,,,,,,810," + currency + ",,,creator_subtotal,,60,76\r\n" +
		"2026-07," + author.ID.String() + ",Author Person,,,,,,,,,,,540," + currency + ",,,creator_subtotal,,40,51\r\n"
	if got := env.exportRoyalties(t, f.admin, "2026-07"); got != wantCSV {
		t.Fatalf("csv =\n%q\nwant\n%q", got, wantCSV)
	}

	// A refund of a sale made at 10% reaches the line of that rate, and its
	// adjustment takes back the tax that line's payout included: 330 less
	// what 330 is without its tax, 300.
	env.refundAfterClose(t, refunded)
	august := env.previewRoyalties(t, f.admin, "2026-08")
	if len(august.Lines) != 2 {
		t.Fatalf("August lines = %d, want an adjustment per credit", len(august.Lines))
	}
	for _, adjustment := range august.Lines {
		wantPayout, wantTax := int64(-330), int64(-30)
		if adjustment.CreatorName == "Author Person" {
			wantPayout, wantTax = -220, -20
		}
		if adjustment.AdjustedPeriod != "2026-07" || adjustment.GetTaxRateBps() != 1000 ||
			adjustment.PayoutAmount != wantPayout || adjustment.TaxAmount == nil || adjustment.GetTaxAmount() != wantTax {
			t.Fatalf("August adjustment = %+v, want %d paid back with %d of tax at 10%%", adjustment, wantPayout, wantTax)
		}
	}
}

// refundAfterClose stands in for a refund notification of the whole price,
// recorded after the month of the sale was closed.
func (e *adminDBEnv) refundAfterClose(t *testing.T, purchaseID uuid.UUID) {
	t.Helper()
	if _, err := e.PG.DB.ExecContext(context.Background(), `
		UPDATE purchases SET refunded_amount = price_at_purchase, refunded_at = now(), revoked_at = now(), revocation_reason = 'refund' WHERE id = $1
	`, purchaseID); err != nil {
		t.Fatalf("refund purchase %s: %v", purchaseID, err)
	}
}

// A tenant with no rate and no withholding closes the statements it closed
// before: no line has a rate, the totals carry neither figure, and the CSV
// has the columns it always had.
func TestDBAdminRoyaltyStatementOfATenantWithoutRatesIsUnchanged(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	f := env.seedRoyaltyFixture(t, "RTN")
	artist := env.PG.SeedCreator(t, f.admin.Tenant.ID, testutil.CreatorSeed{PublicID: "RTNARTIST001", Name: "Artist Person"})
	env.creditEpisode(t, f.admin.Tenant.ID, f.episode.ID, artist.ID, "Artist", "series", 3000)
	env.seedSale(t, f, f.episode.ID, royaltySale{price: 500, purchasedAt: inRoyaltyZone(2026, time.July, 10, 12, 0, 0)})

	statement := env.closeRoyalties(t, f.admin, "2026-07")
	if statement.Totals.Tax != nil || statement.Totals.Withholding != nil || statement.WithholdingRateBps != nil {
		t.Fatalf("statement of a tenant without rates = %+v, want no tax and no withholding", statement)
	}
	closed := env.getRoyalties(t, f.admin, &publiraadminv1.GetRoyaltyStatementRequest{Period: "2026-07"})
	if len(closed.Lines) != 1 || closed.Lines[0].TaxRateBps != nil || closed.Lines[0].TaxAmount != nil {
		t.Fatalf("lines = %+v, want one without a rate", closed.Lines)
	}
	if len(closed.CreatorSubtotals) != 1 || closed.CreatorSubtotals[0].PayoutAmount != 150 ||
		closed.CreatorSubtotals[0].TaxAmount != nil || closed.CreatorSubtotals[0].WithholdingAmount != nil {
		t.Fatalf("subtotals = %+v, want the payout alone", closed.CreatorSubtotals)
	}
	header := "\xEF\xBB\xBFperiod,creator_id,creator_name,role_id,role_name,series_id,series_title,episode_id,episode_title,sale_count,gross_amount,refunded_amount,share_percent,payout_amount,currency,adjusted_period,source\r\n"
	csv := env.exportRoyalties(t, f.admin, "2026-07")
	if !strings.HasPrefix(csv, header) || strings.Count(csv, "\r\n") != 2 {
		t.Fatalf("csv =\n%q\nwant the columns statements have always had and one line", csv)
	}
}

// The release before this one closes a month without cutting its lines by
// rate, so a sale that recorded a rate can sit in a line that has none. A
// refund of it is still carried, to that line, rather than looking for a line
// of its rate that the statement does not have.
func TestDBAdminRoyaltyRefundOfARatedSaleReachesALineClosedWithoutRates(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	f := env.seedRoyaltyFixture(t, "RTP")
	artist := env.PG.SeedCreator(t, f.admin.Tenant.ID, testutil.CreatorSeed{PublicID: "RTPARTIST001", Name: "Artist Person"})
	env.creditEpisode(t, f.admin.Tenant.ID, f.episode.ID, artist.ID, "Artist", "series", 3000)
	sale := env.seedSale(t, f, f.episode.ID, royaltySale{price: 1100, purchasedAt: inRoyaltyZone(2026, time.July, 10, 12, 0, 0)})
	env.closeRoyalties(t, f.admin, "2026-07")
	if _, err := env.PG.DB.ExecContext(context.Background(),
		"UPDATE purchases SET tax_rate_bps = 1000, tax_amount = 100 WHERE id = $1", sale); err != nil {
		t.Fatalf("give the closed sale a rate: %v", err)
	}

	env.refundAfterClose(t, sale)
	august := env.previewRoyalties(t, f.admin, "2026-08")
	if len(august.Lines) != 1 || august.Lines[0].PayoutAmount != -330 || august.Lines[0].TaxRateBps != nil || august.Lines[0].TaxAmount != nil {
		t.Fatalf("August lines = %+v, want the refund carried to the line without a rate", august.Lines)
	}
}

// The tax of a period is the tax what the tenant kept includes: a purchase of
// 1100 at 10% with 110 of it refunded kept 990, which includes 90.
func TestDBAdminRevenueStatesTheTaxOfWhatTheTenantKept(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	f := env.seedRoyaltyFixture(t, "RVT")
	env.seedSale(t, f, f.episode.ID, royaltySale{price: 500, purchasedAt: inRoyaltyZone(2026, time.January, 10, 12, 0, 0)})
	env.setTaxRateSince(t, f.admin, sql.NullInt32{Int32: 1000, Valid: true}, inRoyaltyZone(2026, time.January, 11, 0, 0, 0))
	env.seedSale(t, f, f.episode.ID, royaltySale{
		price:          1100,
		purchasedAt:    inRoyaltyZone(2026, time.January, 11, 12, 0, 0),
		refundedAmount: sql.NullInt32{Int32: 110, Valid: true},
	})

	ctx := testutil.WithBearer(context.Background(), f.admin.token())
	for _, groupBy := range []publiraadminv1.RevenueGroupBy{
		publiraadminv1.RevenueGroupBy_REVENUE_GROUP_BY_DAY,
		publiraadminv1.RevenueGroupBy_REVENUE_GROUP_BY_SERIES,
		publiraadminv1.RevenueGroupBy_REVENUE_GROUP_BY_EPISODE,
	} {
		res, err := env.engagementClient().GetRevenueStats(ctx, &publiraadminv1.GetRevenueStatsRequest{
			Tenant:    f.admin.tenantContext(),
			StartDate: "2026-01-10",
			EndDate:   "2026-01-11",
			GroupBy:   groupBy,
		})
		if err != nil {
			t.Fatalf("GetRevenueStats %v: %v", groupBy, err)
		}
		if res.Totals.NetAmount != 1490 || res.Totals.TaxAmount != 90 {
			t.Fatalf("%v totals = %+v, want net 1490 including 90 of tax", groupBy, res.Totals)
		}
		var rowTax int64
		for _, row := range res.Rows {
			rowTax += row.TaxAmount
		}
		if rowTax != 90 {
			t.Fatalf("%v rows' tax = %d, want 90", groupBy, rowTax)
		}
	}
}

func equalOptional[T comparable](a, b *T) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

func deref[T any](value *T) any {
	if value == nil {
		return nil
	}
	return *value
}

// A pack of coins is paid in advance for the episodes its coins buy, so it
// records no tax, and an episode paid with its coins records the tax of what
// they were paid for.
func TestDBTaxIsRecordedOnTheEpisodesCoinsPayForAndNotOnTheirPack(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	f := env.seedRoyaltyFixture(t, "TXC")
	env.setTaxRateSince(t, f.admin, sql.NullInt32{Int32: 1000, Valid: true}, inRoyaltyZone(2026, time.January, 1, 0, 0, 0))

	pack, grant := env.seedPackSale(t, f, 1000, 1100, inRoyaltyZone(2026, time.January, 10, 12, 0, 0))
	if rate, tax := env.purchaseTax(t, pack); rate.Valid || tax.Valid {
		t.Fatalf("pack of coins recorded %v and %v, want no tax", rate, tax)
	}
	episode := env.seedCoinSale(t, f, f.episode.ID, grant, 500, 550, inRoyaltyZone(2026, time.January, 11, 12, 0, 0))
	if rate, tax := env.purchaseTax(t, episode); rate.Int32 != 1000 || tax.Int32 != 50 {
		t.Fatalf("episode paid with coins worth 550 recorded %v and %v, want 1000 and 50", rate, tax)
	}
}
