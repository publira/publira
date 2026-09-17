package adminapi

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	"github.com/publira/publira/server/internal/testutil"
)

// royaltyTokyo is the zone testutil.SeedTenant gives every tenant.
var royaltyTokyo = time.FixedZone("Asia/Tokyo", 9*60*60)

func (e *adminDBEnv) royaltyClient() publiraadminv1connect.AdminRoyaltyServiceClient {
	return publiraadminv1connect.NewAdminRoyaltyServiceClient(e.Server.Client(), e.Server.URL)
}

// royaltyFixture is one tenant with a priced episode and a reader to buy it.
type royaltyFixture struct {
	admin   adminDBTenant
	series  testutil.Series
	episode testutil.Episode
	reader  testutil.TenantUser
}

func (e *adminDBEnv) seedRoyaltyFixture(t *testing.T, prefix string) royaltyFixture {
	t.Helper()

	admin := e.seedTenantWithAdmin(t, prefix+"TENANT01", prefix+".example.com", "Royalty "+prefix, prefix+"ADMIN001", "admin@"+prefix+".example.com")
	series := e.PG.SeedSeries(t, admin.Tenant.ID, testutil.SeriesSeed{PublicID: prefix + "SERIES01", Title: "Royalty Series"})
	episode := e.PG.SeedEpisode(t, admin.Tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: prefix + "EPISODE1",
		Title:    "Episode 1",
		Price:    500,
		Status:   testutil.EpisodeStatusPublished,
	})
	reader := e.PG.SeedEndUser(t, admin.Tenant.ID, prefix+"READER01", "reader@"+prefix+".example.com", "Reader")
	return royaltyFixture{admin: admin, series: series, episode: episode, reader: reader}
}

// creditEpisode credits a creator on the episode with a share. source is
// "series" for the standing team and "episode" for a guest.
func (e *adminDBEnv) creditEpisode(t *testing.T, tenantID, episodeID, creatorID uuid.UUID, roleName, source string, shareBps int32) {
	t.Helper()

	role := e.PG.CreatorRoleByName(t, tenantID, roleName)
	if _, err := e.PG.DB.ExecContext(context.Background(), `
		INSERT INTO episode_creators (tenant_id, episode_id, creator_id, role_id, display_order, source, share_bps)
		VALUES ($1, $2, $3, $4, 0, $5, $6)
	`, tenantID, episodeID, creatorID, role.ID, source, shareBps); err != nil {
		t.Fatalf("credit creator %s on episode %s as %s: %v", creatorID, episodeID, roleName, err)
	}
}

type royaltySale struct {
	price          int32
	purchasedAt    time.Time
	refundedAmount sql.NullInt32
	refundedAt     sql.NullTime
}

func (e *adminDBEnv) seedSale(t *testing.T, f royaltyFixture, episodeID uuid.UUID, sale royaltySale) {
	t.Helper()

	if _, err := e.PG.DB.ExecContext(context.Background(), `
		INSERT INTO purchases (id, tenant_id, user_id, episode_id, price_at_purchase, purchased_at, refunded_amount, refunded_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`, uuid.Must(uuid.NewV7()), f.admin.Tenant.ID, f.reader.ID, episodeID, sale.price, sale.purchasedAt, sale.refundedAmount, sale.refundedAt); err != nil {
		t.Fatalf("insert sale of episode %s: %v", episodeID, err)
	}
}

func (e *adminDBEnv) previewRoyalties(t *testing.T, tenant adminDBTenant, period string) *publiraadminv1.PreviewRoyaltyStatementResponse {
	t.Helper()

	res, err := e.royaltyClient().PreviewRoyaltyStatement(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.PreviewRoyaltyStatementRequest{
		Tenant: tenant.tenantContext(),
		Period: period,
	}))
	if err != nil {
		t.Fatalf("PreviewRoyaltyStatement %s: %v", period, err)
	}
	return res.Msg
}

func (e *adminDBEnv) closeRoyalties(t *testing.T, tenant adminDBTenant, period string) *publiraadminv1.RoyaltyStatement {
	t.Helper()

	res, err := e.royaltyClient().CloseRoyaltyStatement(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CloseRoyaltyStatementRequest{
		Tenant: tenant.tenantContext(),
		Period: period,
	}))
	if err != nil {
		t.Fatalf("CloseRoyaltyStatement %s: %v", period, err)
	}
	return res.Msg.Statement
}

func (e *adminDBEnv) getRoyalties(t *testing.T, tenant adminDBTenant, req *publiraadminv1.GetRoyaltyStatementRequest) *publiraadminv1.GetRoyaltyStatementResponse {
	t.Helper()

	req.Tenant = tenant.tenantContext()
	res, err := e.royaltyClient().GetRoyaltyStatement(context.Background(), newAdminDBRequest(tenant, req))
	if err != nil {
		t.Fatalf("GetRoyaltyStatement %s: %v", req.Period, err)
	}
	return res.Msg
}

// royaltyLineFigures is what a line says about money, without the names.
type royaltyLineFigures struct {
	saleCount int32
	gross     int64
	refunded  int64
	shareBps  int32
	payout    int64
}

func figuresOf(line *publiraadminv1.RoyaltyStatementLine) royaltyLineFigures {
	return royaltyLineFigures{line.SaleCount, line.GrossAmount, line.RefundedAmount, line.ShareBps, line.PayoutAmount}
}

// linesByCredit keys lines by creator name, role name and episode title, which
// are unique within these fixtures.
func linesByCredit(t *testing.T, lines []*publiraadminv1.RoyaltyStatementLine) map[[3]string]*publiraadminv1.RoyaltyStatementLine {
	t.Helper()

	byCredit := make(map[[3]string]*publiraadminv1.RoyaltyStatementLine, len(lines))
	for _, line := range lines {
		key := [3]string{line.CreatorName, line.RoleName, line.EpisodeTitle}
		if _, ok := byCredit[key]; ok {
			t.Fatalf("two lines for %v", key)
		}
		byCredit[key] = line
	}
	return byCredit
}

func inTokyo(year int, month time.Month, day, hour, minute, second int) time.Time {
	return time.Date(year, month, day, hour, minute, second, 0, royaltyTokyo)
}

func TestDBAdminCloseRoyaltyStatementPaysEachCreditItsShare(t *testing.T) {
	env := newAdminDBEnv(t)
	f := env.seedRoyaltyFixture(t, "RYC")
	artist := env.PG.SeedCreator(t, f.admin.Tenant.ID, testutil.CreatorSeed{PublicID: "RYCARTIST001", Name: "Artist Person"})
	author := env.PG.SeedCreator(t, f.admin.Tenant.ID, testutil.CreatorSeed{PublicID: "RYCAUTHOR001", Name: "Author Person"})
	env.creditEpisode(t, f.admin.Tenant.ID, f.episode.ID, artist.ID, "Artist", "series", 3000)
	env.creditEpisode(t, f.admin.Tenant.ID, f.episode.ID, author.ID, "Original Author", "series", 2000)

	for day := 1; day <= 10; day++ {
		env.seedSale(t, f, f.episode.ID, royaltySale{price: 500, purchasedAt: inTokyo(2026, time.July, day, 12, 0, 0)})
	}
	env.seedSale(t, f, f.episode.ID, royaltySale{
		price:          500,
		purchasedAt:    inTokyo(2026, time.July, 20, 12, 0, 0),
		refundedAmount: sql.NullInt32{Int32: 500, Valid: true},
		refundedAt:     sql.NullTime{Time: inTokyo(2026, time.July, 21, 12, 0, 0), Valid: true},
	})

	want := map[[3]string]royaltyLineFigures{
		{"Artist Person", "Artist", "Episode 1"}:          {saleCount: 10, gross: 5000, shareBps: 3000, payout: 1500},
		{"Author Person", "Original Author", "Episode 1"}: {saleCount: 10, gross: 5000, shareBps: 2000, payout: 1000},
	}
	assertLines := func(label string, lines []*publiraadminv1.RoyaltyStatementLine) {
		t.Helper()
		got := linesByCredit(t, lines)
		if len(got) != len(want) {
			t.Fatalf("%s lines = %d, want %d", label, len(got), len(want))
		}
		for key, figures := range want {
			line, ok := got[key]
			if !ok {
				t.Fatalf("%s has no line for %v", label, key)
			}
			if figuresOf(line) != figures {
				t.Fatalf("%s line %v = %+v, want %+v", label, key, figuresOf(line), figures)
			}
		}
	}

	preview := env.previewRoyalties(t, f.admin, "2026-07")
	assertLines("preview", preview.Lines)
	if preview.Totals.Gross != 5000 || preview.Totals.Refunded != 0 || preview.Totals.Payout != 2500 {
		t.Fatalf("preview totals = %+v, want gross 5000 and payout 2500", preview.Totals)
	}

	statement := env.closeRoyalties(t, f.admin, "2026-07")
	if statement.Period != "2026-07" || statement.TimeZone != "Asia/Tokyo" || statement.ClosedByUserPublicId != f.admin.User.PublicID {
		t.Fatalf("closed statement = %+v, want 2026-07 in Asia/Tokyo closed by %s", statement, f.admin.User.PublicID)
	}
	if statement.Totals.Gross != 5000 || statement.Totals.Payout != 2500 {
		t.Fatalf("closed totals = %+v, want gross 5000 and payout 2500", statement.Totals)
	}

	// A share edited after the close reaches no closed line.
	if _, err := env.PG.DB.ExecContext(context.Background(), "UPDATE episode_creators SET share_bps = 5000 WHERE episode_id = $1", f.episode.ID); err != nil {
		t.Fatalf("edit shares: %v", err)
	}
	closed := env.getRoyalties(t, f.admin, &publiraadminv1.GetRoyaltyStatementRequest{Period: "2026-07"})
	assertLines("closed statement", closed.Lines)
	if closed.Statement.Totals.Payout != 2500 {
		t.Fatalf("closed payout after a share edit = %d, want 2500", closed.Statement.Totals.Payout)
	}

	logs := env.readerAuditLogs(t, f.admin)
	if len(logs) != 1 || logs[0].Action != "royalty_statement_closed" || logs[0].TargetType != "royalty_statement" ||
		logs[0].TargetId != "2026-07" || logs[0].ActorUserPublicId != f.admin.User.PublicID {
		t.Fatalf("audit logs = %+v, want one close of 2026-07 by %s", logs, f.admin.User.PublicID)
	}
}

func TestDBAdminCloseRoyaltyStatementClosesAMonthOnce(t *testing.T) {
	env := newAdminDBEnv(t)
	f := env.seedRoyaltyFixture(t, "RYO")
	creator := env.PG.SeedCreator(t, f.admin.Tenant.ID, testutil.CreatorSeed{PublicID: "RYOCREATOR01", Name: "Creator"})
	env.creditEpisode(t, f.admin.Tenant.ID, f.episode.ID, creator.ID, "Artist", "series", 5000)
	env.seedSale(t, f, f.episode.ID, royaltySale{price: 500, purchasedAt: inTokyo(2026, time.July, 3, 9, 0, 0)})
	env.closeRoyalties(t, f.admin, "2026-07")

	// A sale that appears afterwards must not be picked up by a second close.
	env.seedSale(t, f, f.episode.ID, royaltySale{price: 500, purchasedAt: inTokyo(2026, time.July, 4, 9, 0, 0)})

	client := env.royaltyClient()
	_, err := client.CloseRoyaltyStatement(context.Background(), newAdminDBRequest(f.admin, &publiraadminv1.CloseRoyaltyStatementRequest{
		Tenant: f.admin.tenantContext(),
		Period: "2026-07",
	}))
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("second close error = %v, want already_exists", err)
	}
	_, err = client.PreviewRoyaltyStatement(context.Background(), newAdminDBRequest(f.admin, &publiraadminv1.PreviewRoyaltyStatementRequest{
		Tenant: f.admin.tenantContext(),
		Period: "2026-07",
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("preview of a closed month error = %v, want failed_precondition", err)
	}

	if count := env.countRows(t, "SELECT count(*) FROM royalty_statements WHERE tenant_id = $1", f.admin.Tenant.ID); count != 1 {
		t.Fatalf("statements after a second close = %d, want 1", count)
	}
	got := env.getRoyalties(t, f.admin, &publiraadminv1.GetRoyaltyStatementRequest{Period: "2026-07"})
	if len(got.Lines) != 1 || got.Lines[0].SaleCount != 1 || got.Statement.Totals.Gross != 500 {
		t.Fatalf("statement after a second close = %+v with lines %+v, want the first close's single sale", got.Statement, got.Lines)
	}
	if logs := env.readerAuditLogs(t, f.admin); len(logs) != 1 {
		t.Fatalf("audit logs after a second close = %d, want 1", len(logs))
	}
}

func TestDBAdminRoyaltyStatementCutsTheMonthInTheTenantZone(t *testing.T) {
	env := newAdminDBEnv(t)
	f := env.seedRoyaltyFixture(t, "RYZ")
	creator := env.PG.SeedCreator(t, f.admin.Tenant.ID, testutil.CreatorSeed{PublicID: "RYZCREATOR01", Name: "Creator"})
	env.creditEpisode(t, f.admin.Tenant.ID, f.episode.ID, creator.ID, "Artist", "series", 10000)

	// The first and last second of July in Tokyo belong to July, although both
	// fall on another UTC day than their Tokyo one.
	env.seedSale(t, f, f.episode.ID, royaltySale{price: 100, purchasedAt: inTokyo(2026, time.July, 1, 0, 0, 0)})
	env.seedSale(t, f, f.episode.ID, royaltySale{price: 200, purchasedAt: inTokyo(2026, time.July, 31, 23, 59, 0)})
	env.seedSale(t, f, f.episode.ID, royaltySale{price: 400, purchasedAt: inTokyo(2026, time.June, 30, 23, 59, 59)})
	env.seedSale(t, f, f.episode.ID, royaltySale{price: 800, purchasedAt: inTokyo(2026, time.August, 1, 0, 0, 0)})

	statement := env.closeRoyalties(t, f.admin, "2026-07")
	if statement.Totals.Gross != 300 || statement.Totals.Payout != 300 {
		t.Fatalf("July totals = %+v, want the two July sales totalling 300", statement.Totals)
	}
	august := env.previewRoyalties(t, f.admin, "2026-08")
	if august.Totals.Gross != 800 {
		t.Fatalf("August gross = %d, want the sale at August 1 00:00 Tokyo", august.Totals.Gross)
	}
}

func TestDBAdminRoyaltyStatementLinesFollowTheCredits(t *testing.T) {
	env := newAdminDBEnv(t)
	f := env.seedRoyaltyFixture(t, "RYL")
	second := env.PG.SeedEpisode(t, f.admin.Tenant.ID, f.series.ID, testutil.EpisodeSeed{
		PublicID: "RYLEPISODE2",
		Title:    "Episode 2",
		Price:    333,
		Status:   testutil.EpisodeStatusPublished,
	})
	both := env.PG.SeedCreator(t, f.admin.Tenant.ID, testutil.CreatorSeed{PublicID: "RYLBOTH00001", Name: "Author And Artist"})
	guest := env.PG.SeedCreator(t, f.admin.Tenant.ID, testutil.CreatorSeed{PublicID: "RYLGUEST0001", Name: "Guest"})
	for _, episodeID := range []uuid.UUID{f.episode.ID, second.ID} {
		env.creditEpisode(t, f.admin.Tenant.ID, episodeID, both.ID, "Original Author", "series", 2000)
		env.creditEpisode(t, f.admin.Tenant.ID, episodeID, both.ID, "Artist", "series", 3333)
	}
	env.creditEpisode(t, f.admin.Tenant.ID, second.ID, guest.ID, "Writer", "episode", 1000)

	env.seedSale(t, f, f.episode.ID, royaltySale{price: 500, purchasedAt: inTokyo(2026, time.July, 5, 10, 0, 0)})
	for day := 6; day <= 8; day++ {
		env.seedSale(t, f, second.ID, royaltySale{price: 333, purchasedAt: inTokyo(2026, time.July, day, 10, 0, 0)})
	}
	// A partial refund keeps the sale and takes its amount off the base.
	env.seedSale(t, f, second.ID, royaltySale{
		price:          333,
		purchasedAt:    inTokyo(2026, time.July, 9, 10, 0, 0),
		refundedAmount: sql.NullInt32{Int32: 100, Valid: true},
	})

	env.closeRoyalties(t, f.admin, "2026-07")
	got := env.getRoyalties(t, f.admin, &publiraadminv1.GetRoyaltyStatementRequest{Period: "2026-07"})

	// Episode 2 sold 4 × 333 = 1332 with 100 refunded, so its base is 1232.
	want := map[[3]string]royaltyLineFigures{
		{"Author And Artist", "Original Author", "Episode 1"}: {saleCount: 1, gross: 500, shareBps: 2000, payout: 100},
		{"Author And Artist", "Artist", "Episode 1"}:          {saleCount: 1, gross: 500, shareBps: 3333, payout: 166},
		{"Author And Artist", "Original Author", "Episode 2"}: {saleCount: 4, gross: 1332, refunded: 100, shareBps: 2000, payout: 246},
		{"Author And Artist", "Artist", "Episode 2"}:          {saleCount: 4, gross: 1332, refunded: 100, shareBps: 3333, payout: 410},
		{"Guest", "Writer", "Episode 2"}:                      {saleCount: 4, gross: 1332, refunded: 100, shareBps: 1000, payout: 123},
	}
	lines := linesByCredit(t, got.Lines)
	if len(lines) != len(want) {
		t.Fatalf("lines = %+v, want %d", got.Lines, len(want))
	}
	for key, figures := range want {
		line, ok := lines[key]
		if !ok {
			t.Fatalf("no line for %v in %+v", key, got.Lines)
		}
		if figuresOf(line) != figures {
			t.Fatalf("line %v = %+v, want %+v", key, figuresOf(line), figures)
		}
	}
	for i, line := range got.Lines {
		if line.LineNumber != int32(i+1) {
			t.Fatalf("line %d numbered %d, want %d", i, line.LineNumber, i+1)
		}
	}
	// Each sale counts once in the totals however many credits it pays.
	if got.Statement.Totals.Gross != 1832 || got.Statement.Totals.Refunded != 100 || got.Statement.Totals.Payout != 1045 {
		t.Fatalf("totals = %+v, want gross 1832, refunded 100, payout 1045", got.Statement.Totals)
	}
}

func TestDBAdminRoyaltyStatementSurvivesDeletedCatalogRows(t *testing.T) {
	env := newAdminDBEnv(t)
	f := env.seedRoyaltyFixture(t, "RYD")
	creator := env.PG.SeedCreator(t, f.admin.Tenant.ID, testutil.CreatorSeed{PublicID: "RYDCREATOR01", Name: "Departed Creator"})
	env.creditEpisode(t, f.admin.Tenant.ID, f.episode.ID, creator.ID, "Artist", "series", 4000)
	env.seedSale(t, f, f.episode.ID, royaltySale{price: 500, purchasedAt: inTokyo(2026, time.July, 3, 9, 0, 0)})
	env.closeRoyalties(t, f.admin, "2026-07")

	ctx := context.Background()
	if _, err := env.PG.DB.ExecContext(ctx, "DELETE FROM creators WHERE id = $1", creator.ID); err != nil {
		t.Fatalf("delete creator: %v", err)
	}
	if _, err := env.PG.DB.ExecContext(ctx, "UPDATE episodes SET title = 'Renamed' WHERE id = $1", f.episode.ID); err != nil {
		t.Fatalf("rename episode: %v", err)
	}

	got := env.getRoyalties(t, f.admin, &publiraadminv1.GetRoyaltyStatementRequest{Period: "2026-07"})
	if len(got.Lines) != 1 {
		t.Fatalf("lines after deleting the creator = %+v, want 1", got.Lines)
	}
	line := got.Lines[0]
	if line.CreatorPublicId != "" || line.CreatorName != "Departed Creator" || line.EpisodeTitle != "Episode 1" ||
		line.EpisodePublicId != f.episode.PublicID || line.PayoutAmount != 200 {
		t.Fatalf("line after deleting the creator = %+v, want the name and payout as closed and no creator public id", line)
	}
}

func TestDBAdminRoyaltyStatementRefusesMonthsNotOverAndOtherCallers(t *testing.T) {
	env := newAdminDBEnv(t)
	f := env.seedRoyaltyFixture(t, "RYR")
	other := env.seedTenantWithAdmin(t, "RYRTENANT02", "ryr-other.example.com", "Other", "RYRADMIN002", "admin@ryr-other.example.com")
	editor := env.PG.SeedTenantUser(t, f.admin.Tenant.ID, "RYREDITOR01", "editor@ryr.example.com", "Editor", auth.RoleTenantEditor)
	client := env.royaltyClient()
	ctx := context.Background()

	now := time.Now().In(royaltyTokyo)
	current := now.Format("2006-01")
	next := now.AddDate(0, 0, -now.Day()+1).AddDate(0, 1, 0).Format("2006-01")

	_, err := client.CloseRoyaltyStatement(ctx, newAdminDBRequest(f.admin, &publiraadminv1.CloseRoyaltyStatementRequest{Tenant: f.admin.tenantContext(), Period: current}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("close of the current month error = %v, want failed_precondition", err)
	}
	env.previewRoyalties(t, f.admin, current)
	_, err = client.PreviewRoyaltyStatement(ctx, newAdminDBRequest(f.admin, &publiraadminv1.PreviewRoyaltyStatementRequest{Tenant: f.admin.tenantContext(), Period: next}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("preview of next month error = %v, want failed_precondition", err)
	}
	_, err = client.CloseRoyaltyStatement(ctx, newAdminDBRequest(f.admin, &publiraadminv1.CloseRoyaltyStatementRequest{Tenant: f.admin.tenantContext(), Period: "2026-7"}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("close of a malformed period error = %v, want invalid_argument", err)
	}

	_, err = client.CloseRoyaltyStatement(ctx, newAdminDBRequest(f.admin.as(editor), &publiraadminv1.CloseRoyaltyStatementRequest{Tenant: f.admin.tenantContext(), Period: "2026-07"}))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("close by an editor error = %v, want permission_denied", err)
	}

	env.closeRoyalties(t, f.admin, "2026-07")
	_, err = client.GetRoyaltyStatement(ctx, newAdminDBRequest(other, &publiraadminv1.GetRoyaltyStatementRequest{Tenant: other.tenantContext(), Period: "2026-07"}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("another tenant's read error = %v, want not_found", err)
	}
	if count := env.countRows(t, "SELECT count(*) FROM royalty_statements WHERE tenant_id = $1", f.admin.Tenant.ID); count != 1 {
		t.Fatalf("statements = %d, want only the admin's close", count)
	}
}

func TestDBAdminRoyaltyStatementsPage(t *testing.T) {
	env := newAdminDBEnv(t)
	f := env.seedRoyaltyFixture(t, "RYP")
	creator := env.PG.SeedCreator(t, f.admin.Tenant.ID, testutil.CreatorSeed{PublicID: "RYPCREATOR01", Name: "Creator"})
	for i, role := range []string{"Original Author", "Artist", "Writer"} {
		env.creditEpisode(t, f.admin.Tenant.ID, f.episode.ID, creator.ID, role, "series", int32(1000*(i+1)))
	}
	env.seedSale(t, f, f.episode.ID, royaltySale{price: 500, purchasedAt: inTokyo(2026, time.May, 3, 9, 0, 0)})
	for _, period := range []string{"2026-05", "2026-06", "2026-07"} {
		env.closeRoyalties(t, f.admin, period)
	}
	client := env.royaltyClient()
	ctx := context.Background()

	list := func(token string) *publiraadminv1.ListRoyaltyStatementsResponse {
		t.Helper()
		res, err := client.ListRoyaltyStatements(ctx, newAdminDBRequest(f.admin, &publiraadminv1.ListRoyaltyStatementsRequest{Tenant: f.admin.tenantContext(), Limit: 2, Token: token}))
		if err != nil {
			t.Fatalf("ListRoyaltyStatements: %v", err)
		}
		return res.Msg
	}
	periods := func(statements []*publiraadminv1.RoyaltyStatement) []string {
		out := make([]string, 0, len(statements))
		for _, statement := range statements {
			out = append(out, statement.Period)
		}
		return out
	}
	first := list("")
	if got := periods(first.Statements); len(got) != 2 || got[0] != "2026-07" || got[1] != "2026-06" || first.PreviousToken != "" || first.NextToken == "" {
		t.Fatalf("first page = %v (%q, %q), want 2026-07 and 2026-06 with a next token", got, first.PreviousToken, first.NextToken)
	}
	last := list(first.NextToken)
	if got := periods(last.Statements); len(got) != 1 || got[0] != "2026-05" || last.NextToken != "" || last.PreviousToken == "" {
		t.Fatalf("last page = %v (%q, %q), want 2026-05 with a previous token", got, last.PreviousToken, last.NextToken)
	}
	back := list(last.PreviousToken)
	if got := periods(back.Statements); len(got) != 2 || got[0] != "2026-07" || got[1] != "2026-06" {
		t.Fatalf("page back = %v, want 2026-07 and 2026-06", got)
	}

	page := env.getRoyalties(t, f.admin, &publiraadminv1.GetRoyaltyStatementRequest{Period: "2026-05", Limit: 2})
	if len(page.Lines) != 2 || page.Lines[0].LineNumber != 1 || page.NextToken == "" || page.PreviousToken != "" {
		t.Fatalf("first line page = %+v (%q, %q), want lines 1 and 2 with a next token", page.Lines, page.PreviousToken, page.NextToken)
	}
	rest := env.getRoyalties(t, f.admin, &publiraadminv1.GetRoyaltyStatementRequest{Period: "2026-05", Limit: 2, Token: page.NextToken})
	if len(rest.Lines) != 1 || rest.Lines[0].LineNumber != 3 || rest.NextToken != "" || rest.PreviousToken == "" {
		t.Fatalf("second line page = %+v (%q, %q), want line 3 with a previous token", rest.Lines, rest.PreviousToken, rest.NextToken)
	}
	before := env.getRoyalties(t, f.admin, &publiraadminv1.GetRoyaltyStatementRequest{Period: "2026-05", Limit: 2, Token: rest.PreviousToken})
	if len(before.Lines) != 2 || before.Lines[0].LineNumber != 1 || before.Lines[1].LineNumber != 2 {
		t.Fatalf("line page back = %+v, want lines 1 and 2", before.Lines)
	}

	// A line token names the statement it was issued for.
	_, err := client.GetRoyaltyStatement(ctx, newAdminDBRequest(f.admin, &publiraadminv1.GetRoyaltyStatementRequest{Tenant: f.admin.tenantContext(), Period: "2026-06", Token: page.NextToken}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("line token of another period error = %v, want invalid_argument", err)
	}
}

func TestDBRoyaltyStatementCannotBeRewrittenButGoesWithItsTenant(t *testing.T) {
	env := newAdminDBEnv(t)
	f := env.seedRoyaltyFixture(t, "RYI")
	creator := env.PG.SeedCreator(t, f.admin.Tenant.ID, testutil.CreatorSeed{PublicID: "RYICREATOR01", Name: "Creator"})
	env.creditEpisode(t, f.admin.Tenant.ID, f.episode.ID, creator.ID, "Artist", "series", 5000)
	env.seedSale(t, f, f.episode.ID, royaltySale{price: 500, purchasedAt: inTokyo(2026, time.July, 3, 9, 0, 0)})
	env.closeRoyalties(t, f.admin, "2026-07")

	rewrites := []string{
		"UPDATE royalty_statements SET total_payout = 0 WHERE tenant_id = $1",
		"UPDATE royalty_statement_lines SET payout_amount = 0, share_bps = 0 WHERE tenant_id = $1",
		"DELETE FROM royalty_statement_lines WHERE tenant_id = $1",
		"DELETE FROM royalty_statements WHERE tenant_id = $1",
	}
	// Neither the console's own role nor one that bypasses RLS may rewrite a
	// closed month.
	env.withTenantConn(t, f.admin.Tenant.ID, func(ctx context.Context, conn *sql.Conn) {
		for _, statement := range rewrites {
			if _, err := conn.ExecContext(ctx, statement, f.admin.Tenant.ID); err == nil {
				t.Fatalf("%q as publira_admin succeeded, want it refused", statement)
			}
		}
	})
	for _, statement := range rewrites {
		if _, err := env.PG.DB.ExecContext(context.Background(), statement, f.admin.Tenant.ID); err == nil {
			t.Fatalf("%q as the superuser succeeded, want it refused", statement)
		}
	}
	if count := env.countRows(t, "SELECT count(*) FROM royalty_statement_lines WHERE tenant_id = $1 AND payout_amount = 250", f.admin.Tenant.ID); count != 1 {
		t.Fatalf("closed lines after refused rewrites = %d, want the one line as closed", count)
	}

	// A referential action still reaches a statement. A tenant with a catalog
	// cannot be deleted at all, so this one closed a month it sold nothing in.
	empty := env.seedTenantWithAdmin(t, "RYITENANT02", "ryi-empty.example.com", "Empty", "RYIADMIN002", "admin@ryi-empty.example.com")
	env.closeRoyalties(t, empty, "2026-07")
	if _, err := env.PG.DB.ExecContext(context.Background(), "DELETE FROM tenants WHERE id = $1", empty.Tenant.ID); err != nil {
		t.Fatalf("delete tenant with a closed statement: %v", err)
	}
	if count := env.countRows(t, "SELECT count(*) FROM royalty_statements WHERE tenant_id = $1", empty.Tenant.ID); count != 0 {
		t.Fatalf("statements after deleting the tenant = %d, want 0", count)
	}
}
