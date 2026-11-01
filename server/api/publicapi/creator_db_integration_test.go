package publicapi

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/pagination"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/royalties"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/testutil"
)

func (e *publicDBEnv) creatorClient() publirav1connect.CreatorServiceClient {
	return publirav1connect.NewCreatorServiceClient(connect.NewClient(connecthttp.NewTransport(e.Server.Client(), e.Server.URL)))
}

// setCreatorPages turns the tenant's Author pages and their sales figures on
// or off, as the console setting will.
func (e *publicDBEnv) setCreatorPages(t *testing.T, tenantID uuid.UUID, enabled, showSales bool) {
	t.Helper()
	if _, err := e.PG.DB.ExecContext(context.Background(), `
		INSERT INTO tenant_config (tenant_id, creator_pages_enabled, creator_pages_show_sales)
		VALUES ($1, $2, $3)
		ON CONFLICT (tenant_id) DO UPDATE SET
			creator_pages_enabled = EXCLUDED.creator_pages_enabled,
			creator_pages_show_sales = EXCLUDED.creator_pages_show_sales
	`, tenantID, enabled, showSales); err != nil {
		t.Fatalf("set the creator pages: %v", err)
	}
}

// creatorPagesFixture is a tenant with two creators credited together on two
// published episodes, one of them linked to a reader, a sale of the first
// episode last month closed into a statement, and that episode read and sold
// again inside the read-through window.
type creatorPagesFixture struct {
	tenant        testutil.Tenant
	reader        testutil.TenantUser
	creator       testutil.Creator
	coAuthor      testutil.Creator
	firstEpisode  testutil.Episode
	secondEpisode testutil.Episode
	closedPeriod  string
}

func (e *publicDBEnv) seedCreatorPages(t *testing.T, prefix string) creatorPagesFixture {
	t.Helper()
	ctx := context.Background()

	tenant := e.seedTenant(t, prefix+"TEN", prefix+".example.com", "Creator pages "+prefix)
	if _, err := e.PG.DB.ExecContext(ctx, "UPDATE tenants SET timezone = 'UTC' WHERE id = $1", tenant.ID); err != nil {
		t.Fatalf("set the tenant time zone: %v", err)
	}
	reader := e.PG.SeedEndUser(t, tenant.ID, prefix+"RDR", "reader@"+prefix+".example.com", "Linked reader")
	buyer := e.PG.SeedEndUser(t, tenant.ID, prefix+"BUY", "buyer@"+prefix+".example.com", "Buyer")

	series := e.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: prefix + "SER", Title: "Shared series", Published: true})
	firstEpisode := e.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: prefix + "EP1", Title: "First episode", Price: 500, Status: testutil.EpisodeStatusPublished})
	secondEpisode := e.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: prefix + "EP2", Title: "Second episode", Price: 500, Status: testutil.EpisodeStatusPublished})
	draftEpisode := e.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: prefix + "EP3", Title: "Draft episode", Price: 500})

	creator := e.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: prefix + "CRA", Name: "Linked creator"})
	coAuthor := e.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: prefix + "CRB", Name: "Co-author"})
	e.PG.SeedSeriesCreator(t, tenant.ID, series.ID, creator.ID, "")
	for _, episode := range []testutil.Episode{firstEpisode, secondEpisode, draftEpisode} {
		e.PG.SeedEpisodeCreator(t, tenant.ID, episode.ID, creator.ID, "")
		e.PG.SeedEpisodeCreator(t, tenant.ID, episode.ID, coAuthor.ID, "")
	}
	if _, err := e.PG.DB.ExecContext(ctx, "UPDATE episode_creators SET share_bps = 1000 WHERE tenant_id = $1", tenant.ID); err != nil {
		t.Fatalf("set the shares: %v", err)
	}
	e.PG.SeedCreatorAccount(t, tenant.ID, creator.ID, reader.ID)
	if _, err := e.PG.DB.ExecContext(ctx,
		"INSERT INTO creator_follows (tenant_id, user_id, creator_id) VALUES ($1, $2, $3)", tenant.ID, buyer.ID, creator.ID,
	); err != nil {
		t.Fatalf("follow the creator: %v", err)
	}

	// Last month's sale, closed into a statement with a line for each creator.
	currency := e.PG.TenantCurrency(t, tenant.ID)
	now := time.Now().UTC()
	thisMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	lastMonth := thisMonth.AddDate(0, -1, 0)
	if _, err := e.PG.DB.ExecContext(ctx, `
		INSERT INTO purchases (id, tenant_id, user_id, episode_id, price_at_purchase, purchased_at, currency)
		VALUES ($1, $2, $3, $4, 500, $5, $6)
	`, uuid.Must(uuid.NewV7()), tenant.ID, buyer.ID, firstEpisode.ID, lastMonth.Add(36*time.Hour), currency); err != nil {
		t.Fatalf("insert last month's sale: %v", err)
	}
	if _, err := royalties.CloseStatement(ctx, e.PG.DB,
		royalties.Month{TenantID: tenant.ID, Period: lastMonth, TimeZone: "UTC"}, uuid.NullUUID{}, now, nil,
	); err != nil {
		t.Fatalf("close last month: %v", err)
	}

	// Inside the window: the first episode read by three members and finished
	// by two, the second opened by one, and the first sold twice.
	yesterday := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC).AddDate(0, 0, -1)
	for _, stats := range []struct {
		episodeID       uuid.UUID
		memberViewCount int64
		completeCount   int64
	}{
		{firstEpisode.ID, 3, 2},
		{secondEpisode.ID, 1, 0},
		{draftEpisode.ID, 9, 9},
	} {
		if _, err := e.PG.DB.ExecContext(ctx, `
			INSERT INTO content_daily_stats (id, tenant_id, stat_date, entity_type, entity_id, member_view_count, complete_count)
			VALUES ($1, $2, $3, 'episode', $4, $5, $6)
		`, uuid.Must(uuid.NewV7()), tenant.ID, yesterday, stats.episodeID, stats.memberViewCount, stats.completeCount); err != nil {
			t.Fatalf("insert the daily stats: %v", err)
		}
	}
	for range 2 {
		if _, err := e.PG.DB.ExecContext(ctx, `
			INSERT INTO purchases (id, tenant_id, user_id, episode_id, price_at_purchase, purchased_at, currency)
			VALUES ($1, $2, $3, $4, 500, $5, $6)
		`, uuid.Must(uuid.NewV7()), tenant.ID, buyer.ID, firstEpisode.ID, yesterday.Add(12*time.Hour), currency); err != nil {
			t.Fatalf("insert a sale in the window: %v", err)
		}
	}

	return creatorPagesFixture{
		tenant:        tenant,
		reader:        reader,
		creator:       creator,
		coAuthor:      coAuthor,
		firstEpisode:  firstEpisode,
		secondEpisode: secondEpisode,
		closedPeriod:  royalties.FormatPeriod(lastMonth),
	}
}

func assertFailedPreconditionReason(t *testing.T, name string, err error, reason string) {
	t.Helper()
	if connect.CodeOf(err) != connect.CodeFailedPrecondition || errorInfoOf(t, err).GetReason() != reason {
		t.Fatalf("%s: error = %v, want failed_precondition with %s", name, err, reason)
	}
}

// A linked reader reads their creator's figures and their creator's lines of a
// closed statement, and nothing of the co-author credited beside them.
func TestDBCreatorServiceAnswersALinkedReaderAboutTheirOwnCreator(t *testing.T) {
	t.Parallel()

	env := newPublicDBEnv(t)
	f := env.seedCreatorPages(t, "CRPAGEA")
	env.setCreatorPages(t, f.tenant.ID, true, true)
	client := env.creatorClient()
	ctx := testutil.WithBearer(context.Background(), tokenFor(t, f.tenant, f.reader))

	tenant, err := env.tenantAPIClient().GetTenant(context.Background(), &publirav1.GetTenantRequest{Tenant: tenantContext(f.tenant)})
	if err != nil {
		t.Fatalf("GetTenant: %v", err)
	}
	if !tenant.CreatorPagesEnabled {
		t.Fatal("creator_pages_enabled = false, want true")
	}

	creators, err := client.ListMyCreators(ctx, &publirav1.ListMyCreatorsRequest{Tenant: tenantContext(f.tenant)})
	if err != nil {
		t.Fatalf("ListMyCreators: %v", err)
	}
	if !creators.SalesVisible {
		t.Fatal("sales_visible = false, want true")
	}
	if len(creators.Creators) != 1 || creators.Creators[0].Id != f.creator.ID.String() {
		t.Fatalf("creators = %v, want the linked creator alone", creators.Creators)
	}
	if got := creators.Creators[0].PublishedSeriesCount; got != 1 {
		t.Fatalf("published_series_count = %d, want 1", got)
	}

	// One episode a page, so the second page is reached through the token.
	first, err := client.GetMyCreatorStats(ctx, &publirav1.GetMyCreatorStatsRequest{
		Tenant: tenantContext(f.tenant), CreatorId: f.creator.ID.String(), Limit: 1,
	})
	if err != nil {
		t.Fatalf("GetMyCreatorStats: %v", err)
	}
	if first.FollowerCount != 1 {
		t.Fatalf("follower_count = %d, want 1", first.FollowerCount)
	}
	// The draft episode is credited too, and read, and counted nowhere.
	if first.TotalMemberViewCount != 4 || first.TotalCompleteCount != 2 {
		t.Fatalf("totals = %d views, %d completions, want 4 and 2", first.TotalMemberViewCount, first.TotalCompleteCount)
	}
	if first.TimeZone != "UTC" || first.PeriodEnd != time.Now().UTC().AddDate(0, 0, -1).Format(time.DateOnly) {
		t.Fatalf("window = %s..%s in %s, want ending yesterday in UTC", first.PeriodStart, first.PeriodEnd, first.TimeZone)
	}
	if len(first.Episodes) != 1 || first.NextToken == "" {
		t.Fatalf("first page = %d episodes, next token %q, want one and a next page", len(first.Episodes), first.NextToken)
	}
	top := first.Episodes[0]
	if top.EpisodePublicId != f.firstEpisode.PublicID || top.MemberViewCount != 3 || top.CompleteCount != 2 {
		t.Fatalf("first episode = %+v, want %s with 3 views and 2 completions", top, f.firstEpisode.PublicID)
	}
	if top.PurchaseCount == nil || *top.PurchaseCount != 2 || top.NetAmount == nil || *top.NetAmount != 1000 {
		t.Fatalf("first episode sales = %v purchases, %v net, want 2 and 1000", top.PurchaseCount, top.NetAmount)
	}

	second, err := client.GetMyCreatorStats(ctx, &publirav1.GetMyCreatorStatsRequest{
		Tenant: tenantContext(f.tenant), CreatorId: f.creator.ID.String(), Limit: 1, Token: first.NextToken,
	})
	if err != nil {
		t.Fatalf("GetMyCreatorStats second page: %v", err)
	}
	if len(second.Episodes) != 1 || second.NextToken != "" || second.PreviousToken == "" {
		t.Fatalf("second page = %d episodes, tokens %q / %q, want the last page", len(second.Episodes), second.PreviousToken, second.NextToken)
	}
	unread := second.Episodes[0]
	if unread.EpisodePublicId != f.secondEpisode.PublicID || unread.CompleteCount != 0 {
		t.Fatalf("second episode = %+v, want %s with no completions", unread, f.secondEpisode.PublicID)
	}
	if unread.PurchaseCount == nil || *unread.PurchaseCount != 0 {
		t.Fatalf("second episode purchase_count = %v, want a 0 that is set", unread.PurchaseCount)
	}

	// The co-author's token does not page the creator's list.
	if _, err := client.GetMyCreatorStats(ctx, &publirav1.GetMyCreatorStatsRequest{
		Tenant: tenantContext(f.tenant), CreatorId: f.creator.ID.String(), Limit: 1,
		Token: pagingTokenForAnotherCreator(t, first.NextToken, f),
	}); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("GetMyCreatorStats with another creator's token: error = %v, want invalid_argument", err)
	}

	statements, err := client.ListMyCreatorStatements(ctx, &publirav1.ListMyCreatorStatementsRequest{
		Tenant: tenantContext(f.tenant), CreatorId: f.creator.ID.String(),
	})
	if err != nil {
		t.Fatalf("ListMyCreatorStatements: %v", err)
	}
	if len(statements.Statements) != 1 {
		t.Fatalf("statements = %d, want 1", len(statements.Statements))
	}
	month := statements.Statements[0]
	if month.Period != f.closedPeriod || month.SaleCount != 1 || month.GrossAmount != 500 || month.PayoutAmount != 50 {
		t.Fatalf("statement = %+v, want %s with one sale of 500 paying 50", month, f.closedPeriod)
	}

	// The statement holds a line for each creator; the reader reads their own.
	if got := env.countRows(t,
		"SELECT count(*) FROM royalty_statement_lines l JOIN royalty_statements s ON s.id = l.statement_id WHERE s.tenant_id = $1",
		f.tenant.ID,
	); got != 2 {
		t.Fatalf("statement lines = %d, want one for each creator", got)
	}
	statement, err := client.GetMyCreatorStatement(ctx, &publirav1.GetMyCreatorStatementRequest{
		Tenant: tenantContext(f.tenant), CreatorId: f.creator.ID.String(), Period: f.closedPeriod,
	})
	if err != nil {
		t.Fatalf("GetMyCreatorStatement: %v", err)
	}
	if statement.Statement.PayoutAmount != 50 {
		t.Fatalf("statement payout = %d, want the creator's 50", statement.Statement.PayoutAmount)
	}
	if len(statement.Lines) != 1 {
		t.Fatalf("lines = %d, want the creator's one", len(statement.Lines))
	}
	if line := statement.Lines[0]; line.EpisodePublicId != f.firstEpisode.PublicID || line.ShareBps != 1000 || line.PayoutAmount != 50 || line.Source != publirav1.CreatorStatementLineSource_CREATOR_STATEMENT_LINE_SOURCE_SALE {
		t.Fatalf("line = %+v, want the creator's line of %s", line, f.firstEpisode.PublicID)
	}

	// A month that is not closed is not a statement.
	if _, err := client.GetMyCreatorStatement(ctx, &publirav1.GetMyCreatorStatementRequest{
		Tenant: tenantContext(f.tenant), CreatorId: f.creator.ID.String(), Period: time.Now().UTC().Format("2006-01"),
	}); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetMyCreatorStatement of the open month: error = %v, want not_found", err)
	}
}

// pagingTokenForAnotherCreator rebuilds a token of the creator's list with the
// same boundary, as the co-author's list would name it.
func pagingTokenForAnotherCreator(t *testing.T, token string, f creatorPagesFixture) string {
	t.Helper()
	surface, err := callingSurface(publirattypesv1.ClientSurface_CLIENT_SURFACE_UNSPECIFIED)
	if err != nil {
		t.Fatalf("resolve the surface: %v", err)
	}
	cursor, err := decodeSurfaceToken(token, surface)
	if err != nil {
		t.Fatalf("decode the token: %v", err)
	}
	keys, err := pagination.NewListKey(creatorStatsListOrder).Value("creator", f.creator.ID.String()).DecodeCountUUID(cursor)
	if err != nil {
		t.Fatalf("decode the token's keys: %v", err)
	}
	forged := pagination.NewListKey(creatorStatsListOrder).Value("creator", f.coAuthor.ID.String()).
		EncodeCountUUID(cursor.Direction, keys.Count, keys.ID)
	bindSurfaceTokens(surface, &forged)
	return forged
}

// A creator the reader is not linked to is not found, whether it is the
// co-author credited beside their own or a creator of another tenant's.
func TestDBCreatorServiceDoesNotAnswerAboutAnUnlinkedCreator(t *testing.T) {
	t.Parallel()

	env := newPublicDBEnv(t)
	f := env.seedCreatorPages(t, "CRPAGEB")
	env.setCreatorPages(t, f.tenant.ID, true, true)
	client := env.creatorClient()
	ctx := testutil.WithBearer(context.Background(), tokenFor(t, f.tenant, f.reader))

	for _, creatorID := range []string{f.coAuthor.ID.String(), uuid.Must(uuid.NewV7()).String()} {
		_, statsErr := client.GetMyCreatorStats(ctx, &publirav1.GetMyCreatorStatsRequest{Tenant: tenantContext(f.tenant), CreatorId: creatorID})
		_, listErr := client.ListMyCreatorStatements(ctx, &publirav1.ListMyCreatorStatementsRequest{Tenant: tenantContext(f.tenant), CreatorId: creatorID})
		_, getErr := client.GetMyCreatorStatement(ctx, &publirav1.GetMyCreatorStatementRequest{Tenant: tenantContext(f.tenant), CreatorId: creatorID, Period: f.closedPeriod})
		for name, err := range map[string]error{
			"GetMyCreatorStats":       statsErr,
			"ListMyCreatorStatements": listErr,
			"GetMyCreatorStatement":   getErr,
		} {
			if connect.CodeOf(err) != connect.CodeNotFound {
				t.Fatalf("%s of creator %s: error = %v, want not_found", name, creatorID, err)
			}
		}
	}

	// Without a session there is no account to be linked.
	if _, err := client.ListMyCreators(context.Background(), &publirav1.ListMyCreatorsRequest{Tenant: tenantContext(f.tenant)}); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("ListMyCreators without a session: error = %v, want unauthenticated", err)
	}
}

// A link is a reader's, so an account that holds a staff role reads as linked
// to none, even one linked before it became staff.
func TestDBCreatorServiceAnswersAStaffSessionWithNoCreators(t *testing.T) {
	t.Parallel()

	env := newPublicDBEnv(t)
	f := env.seedCreatorPages(t, "CRPAGEC")
	env.setCreatorPages(t, f.tenant.ID, true, true)
	env.PG.SeedTenantUserRole(t, f.tenant.ID, f.reader.ID, auth.RoleTenantEditor)
	staff := f.reader
	staff.Role = auth.RoleTenantEditor
	client := env.creatorClient()
	ctx := testutil.WithBearer(context.Background(), tokenFor(t, f.tenant, staff))

	creators, err := client.ListMyCreators(ctx, &publirav1.ListMyCreatorsRequest{Tenant: tenantContext(f.tenant)})
	if err != nil {
		t.Fatalf("ListMyCreators: %v", err)
	}
	if len(creators.Creators) != 0 {
		t.Fatalf("creators = %v, want none for a staff session", creators.Creators)
	}
	if _, err := client.GetMyCreatorStats(ctx, &publirav1.GetMyCreatorStatsRequest{
		Tenant: tenantContext(f.tenant), CreatorId: f.creator.ID.String(),
	}); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetMyCreatorStats as staff: error = %v, want not_found", err)
	}
}

// With sales hidden, the statements are refused and the figures carry no
// sales; with the pages off, every RPC is refused.
func TestDBCreatorServiceKeepsToTheTenantsSwitches(t *testing.T) {
	t.Parallel()

	env := newPublicDBEnv(t)
	f := env.seedCreatorPages(t, "CRPAGED")
	client := env.creatorClient()
	ctx := testutil.WithBearer(context.Background(), tokenFor(t, f.tenant, f.reader))

	env.setCreatorPages(t, f.tenant.ID, true, false)
	creators, err := client.ListMyCreators(ctx, &publirav1.ListMyCreatorsRequest{Tenant: tenantContext(f.tenant)})
	if err != nil {
		t.Fatalf("ListMyCreators with sales hidden: %v", err)
	}
	if creators.SalesVisible {
		t.Fatal("sales_visible = true, want false")
	}
	stats, err := client.GetMyCreatorStats(ctx, &publirav1.GetMyCreatorStatsRequest{
		Tenant: tenantContext(f.tenant), CreatorId: f.creator.ID.String(),
	})
	if err != nil {
		t.Fatalf("GetMyCreatorStats with sales hidden: %v", err)
	}
	if len(stats.Episodes) != 2 {
		t.Fatalf("episodes = %d, want 2", len(stats.Episodes))
	}
	for _, episode := range stats.Episodes {
		if episode.PurchaseCount != nil || episode.NetAmount != nil {
			t.Fatalf("episode %s carries sales %v / %v with sales hidden", episode.EpisodePublicId, episode.PurchaseCount, episode.NetAmount)
		}
	}
	_, listErr := client.ListMyCreatorStatements(ctx, &publirav1.ListMyCreatorStatementsRequest{Tenant: tenantContext(f.tenant), CreatorId: f.creator.ID.String()})
	assertFailedPreconditionReason(t, "ListMyCreatorStatements", listErr, rpcerrors.ReasonCreatorSalesHidden)
	_, getErr := client.GetMyCreatorStatement(ctx, &publirav1.GetMyCreatorStatementRequest{Tenant: tenantContext(f.tenant), CreatorId: f.creator.ID.String(), Period: f.closedPeriod})
	assertFailedPreconditionReason(t, "GetMyCreatorStatement", getErr, rpcerrors.ReasonCreatorSalesHidden)

	env.setCreatorPages(t, f.tenant.ID, false, true)
	tenant, err := env.tenantAPIClient().GetTenant(context.Background(), &publirav1.GetTenantRequest{Tenant: tenantContext(f.tenant)})
	if err != nil {
		t.Fatalf("GetTenant: %v", err)
	}
	if tenant.CreatorPagesEnabled {
		t.Fatal("creator_pages_enabled = true, want false")
	}
	_, listCreatorsErr := client.ListMyCreators(ctx, &publirav1.ListMyCreatorsRequest{Tenant: tenantContext(f.tenant)})
	_, statsErr := client.GetMyCreatorStats(ctx, &publirav1.GetMyCreatorStatsRequest{Tenant: tenantContext(f.tenant), CreatorId: f.creator.ID.String()})
	_, listErr = client.ListMyCreatorStatements(ctx, &publirav1.ListMyCreatorStatementsRequest{Tenant: tenantContext(f.tenant), CreatorId: f.creator.ID.String()})
	_, getErr = client.GetMyCreatorStatement(ctx, &publirav1.GetMyCreatorStatementRequest{Tenant: tenantContext(f.tenant), CreatorId: f.creator.ID.String(), Period: f.closedPeriod})
	for name, err := range map[string]error{
		"ListMyCreators":          listCreatorsErr,
		"GetMyCreatorStats":       statsErr,
		"ListMyCreatorStatements": listErr,
		"GetMyCreatorStatement":   getErr,
	} {
		assertFailedPreconditionReason(t, name, err, rpcerrors.ReasonCreatorPagesDisabled)
	}
}
