package adminapi

import (
	"context"
	"slices"
	"testing"

	"connectrpc.com/connect"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
)

// seedTwoTenants returns two tenants that share a server, so the second one
// stands in for "somebody else's data" in isolation checks.
func seedTwoTenants(t *testing.T, env *adminDBEnv) (adminDBTenant, adminDBTenant) {
	t.Helper()

	first := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	second := env.seedTenantWithAdmin(t, "TENANTB", "tenant-b.example.com", "Tenant B", "TBUSER01", "admin@tenant-b.example.com")
	return first, second
}

func TestDBCreateSeriesPersistsAndReadsBack(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()

	created, err := client.CreateSeries(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateSeriesRequest{
		Tenant:             tenant.tenantContext(),
		Title:              "Integration Series",
		Synopsis:           "A series stored in a real database",
		ReadingPeriodHours: 72,
		IsPublished:        true,
	}))
	if err != nil {
		t.Fatalf("CreateSeries: %v", err)
	}
	series := created.Msg.Series
	if series == nil {
		t.Fatal("CreateSeries returned nil series")
	}
	if series.PublicId == "" {
		t.Fatal("series.public_id is empty")
	}
	if series.Title != "Integration Series" {
		t.Fatalf("series.title = %q, want Integration Series", series.Title)
	}
	if series.Synopsis != "A series stored in a real database" {
		t.Fatalf("series.synopsis = %q", series.Synopsis)
	}
	if series.ReadingPeriodHours != 72 {
		t.Fatalf("series.reading_period_hours = %d, want 72", series.ReadingPeriodHours)
	}
	if !series.IsPublished {
		t.Fatal("series.is_published = false, want true")
	}
	if series.PublishedAt == "" {
		t.Fatal("series.published_at is empty for a published series")
	}

	got, err := client.GetSeries(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.GetSeriesRequest{
		Tenant:   tenant.tenantContext(),
		PublicId: series.PublicId,
	}))
	if err != nil {
		t.Fatalf("GetSeries: %v", err)
	}
	if got.Msg.Series.Title != series.Title || got.Msg.Series.Synopsis != series.Synopsis {
		t.Fatalf("GetSeries = %+v, want title/synopsis of %+v", got.Msg.Series, series)
	}

	listed, err := client.ListSeries(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.ListSeriesRequest{
		Tenant: tenant.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("ListSeries: %v", err)
	}
	if len(listed.Msg.Series) != 1 || listed.Msg.Series[0].PublicId != series.PublicId {
		t.Fatalf("ListSeries = %v, want the single created series %s", seriesPublicIDs(listed.Msg.Series), series.PublicId)
	}

	// The row must carry the tenant, which is also what RLS filters on.
	if count := env.countRows(t,
		"SELECT count(*) FROM series WHERE public_id = $1 AND tenant_id = $2",
		series.PublicId, tenant.Tenant.ID,
	); count != 1 {
		t.Fatalf("series rows for tenant = %d, want 1", count)
	}
}

func TestDBUpdateSeriesPersistsChanges(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()

	created, err := client.CreateSeries(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateSeriesRequest{
		Tenant:   tenant.tenantContext(),
		Title:    "Draft Title",
		Synopsis: "Draft synopsis",
	}))
	if err != nil {
		t.Fatalf("CreateSeries: %v", err)
	}
	publicID := created.Msg.Series.PublicId
	if created.Msg.Series.IsPublished {
		t.Fatal("series.is_published = true, want an unpublished draft")
	}

	updated, err := client.UpdateSeries(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UpdateSeriesRequest{
		Tenant:             tenant.tenantContext(),
		PublicId:           publicID,
		Title:              "Published Title",
		Synopsis:           "Published synopsis",
		ReadingPeriodHours: 24,
		IsPublished:        true,
	}))
	if err != nil {
		t.Fatalf("UpdateSeries: %v", err)
	}
	if updated.Msg.Series.Title != "Published Title" {
		t.Fatalf("updated title = %q, want Published Title", updated.Msg.Series.Title)
	}

	got, err := client.GetSeries(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.GetSeriesRequest{
		Tenant:   tenant.tenantContext(),
		PublicId: publicID,
	}))
	if err != nil {
		t.Fatalf("GetSeries after update: %v", err)
	}
	if got.Msg.Series.Title != "Published Title" {
		t.Fatalf("reloaded title = %q, want Published Title", got.Msg.Series.Title)
	}
	if got.Msg.Series.Synopsis != "Published synopsis" {
		t.Fatalf("reloaded synopsis = %q, want Published synopsis", got.Msg.Series.Synopsis)
	}
	if got.Msg.Series.ReadingPeriodHours != 24 {
		t.Fatalf("reloaded reading_period_hours = %d, want 24", got.Msg.Series.ReadingPeriodHours)
	}
	if !got.Msg.Series.IsPublished || got.Msg.Series.PublishedAt == "" {
		t.Fatalf("reloaded publication = (%v, %q), want published with a timestamp", got.Msg.Series.IsPublished, got.Msg.Series.PublishedAt)
	}
}

func TestDBListSeriesExcludesOtherTenants(t *testing.T) {
	env := newAdminDBEnv(t)
	first, second := seedTwoTenants(t, env)
	client := env.seriesClient()

	mine, err := client.CreateSeries(context.Background(), newAdminDBRequest(first, &publiraadminv1.CreateSeriesRequest{
		Tenant: first.tenantContext(),
		Title:  "Tenant A Series",
	}))
	if err != nil {
		t.Fatalf("CreateSeries for tenant A: %v", err)
	}
	theirs, err := client.CreateSeries(context.Background(), newAdminDBRequest(second, &publiraadminv1.CreateSeriesRequest{
		Tenant: second.tenantContext(),
		Title:  "Tenant B Series",
	}))
	if err != nil {
		t.Fatalf("CreateSeries for tenant B: %v", err)
	}

	listed, err := client.ListSeries(context.Background(), newAdminDBRequest(first, &publiraadminv1.ListSeriesRequest{
		Tenant: first.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("ListSeries for tenant A: %v", err)
	}
	got := seriesPublicIDs(listed.Msg.Series)
	if !slices.Equal(got, []string{mine.Msg.Series.PublicId}) {
		t.Fatalf("tenant A sees %v, want only %s", got, mine.Msg.Series.PublicId)
	}

	_, err = client.GetSeries(context.Background(), newAdminDBRequest(first, &publiraadminv1.GetSeriesRequest{
		Tenant:   first.tenantContext(),
		PublicId: theirs.Msg.Series.PublicId,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetSeries across tenants code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
}

func TestDBUpdateSeriesOfAnotherTenantReturnsNotFound(t *testing.T) {
	env := newAdminDBEnv(t)
	first, second := seedTwoTenants(t, env)
	client := env.seriesClient()

	theirs, err := client.CreateSeries(context.Background(), newAdminDBRequest(second, &publiraadminv1.CreateSeriesRequest{
		Tenant: second.tenantContext(),
		Title:  "Tenant B Series",
	}))
	if err != nil {
		t.Fatalf("CreateSeries for tenant B: %v", err)
	}

	_, err = client.UpdateSeries(context.Background(), newAdminDBRequest(first, &publiraadminv1.UpdateSeriesRequest{
		Tenant:   first.tenantContext(),
		PublicId: theirs.Msg.Series.PublicId,
		Title:    "Hijacked Title",
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("UpdateSeries across tenants code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}

	// The write must not have landed anyway.
	if count := env.countRows(t, "SELECT count(*) FROM series WHERE title = $1", "Hijacked Title"); count != 0 {
		t.Fatalf("series titled Hijacked Title = %d, want 0", count)
	}
}

func TestDBSeriesSessionOfAnotherTenantIsRejected(t *testing.T) {
	env := newAdminDBEnv(t)
	first, second := seedTwoTenants(t, env)
	client := env.seriesClient()

	// Tenant B's admin token pointed at tenant A: the session lookup runs under
	// tenant A's RLS context, where that user does not exist.
	req := newAdminDBRequest(second, &publiraadminv1.ListSeriesRequest{Tenant: first.tenantContext()})
	_, err := client.ListSeries(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("ListSeries with a foreign session code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}
}

func TestDBCreateSeriesRejectsEmptyTitle(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")

	_, err := env.seriesClient().CreateSeries(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateSeriesRequest{
		Tenant: tenant.tenantContext(),
		Title:  "   ",
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("CreateSeries code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	if count := env.countRows(t, "SELECT count(*) FROM series"); count != 0 {
		t.Fatalf("series rows = %d, want 0 after a rejected create", count)
	}
}

func TestDBCreateSeriesWithUnknownLabelReturnsInvalidArgument(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")

	_, err := env.seriesClient().CreateSeries(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateSeriesRequest{
		Tenant:        tenant.tenantContext(),
		Title:         "Series With Label",
		LabelPublicId: "NOSUCHLABEL",
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("CreateSeries code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
}

func TestDBCreateSeriesUnknownCreatorLeavesNoRows(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")

	_, err := env.seriesClient().CreateSeries(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateSeriesRequest{
		Tenant:           tenant.tenantContext(),
		Title:            "Orphan Series",
		Synopsis:         "Should not persist",
		CreatorPublicIds: []string{"NOSUCHCREATOR"},
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("CreateSeries code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	if count := env.countRows(t, "SELECT count(*) FROM series WHERE tenant_id = $1", tenant.Tenant.ID); count != 0 {
		t.Fatalf("series rows = %d, want 0 after a rejected create", count)
	}
	if count := env.countRows(t, "SELECT count(*) FROM series_listings WHERE tenant_id = $1", tenant.Tenant.ID); count != 0 {
		t.Fatalf("series_listings rows = %d, want 0 after a rejected create", count)
	}
	if count := env.countRows(t, "SELECT count(*) FROM series_creators WHERE tenant_id = $1", tenant.Tenant.ID); count != 0 {
		t.Fatalf("series_creators rows = %d, want 0 after a rejected create", count)
	}
}

func TestDBUpdateSeriesUnknownCreatorPreservesExistingLinks(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()

	createdCreator, err := env.creatorClient().CreateCreator(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateCreatorRequest{
		Tenant: tenant.tenantContext(),
		Name:   "Existing Creator",
	}))
	if err != nil {
		t.Fatalf("CreateCreator: %v", err)
	}
	creatorPublicID := createdCreator.Msg.Creator.PublicId

	created, err := client.CreateSeries(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateSeriesRequest{
		Tenant:           tenant.tenantContext(),
		Title:            "Original Title",
		Synopsis:         "Original synopsis",
		CreatorPublicIds: []string{creatorPublicID},
	}))
	if err != nil {
		t.Fatalf("CreateSeries: %v", err)
	}
	publicID := created.Msg.Series.PublicId

	_, err = client.UpdateSeries(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UpdateSeriesRequest{
		Tenant:           tenant.tenantContext(),
		PublicId:         publicID,
		Title:            "Hijacked Title",
		Synopsis:         "Hijacked synopsis",
		CreatorPublicIds: []string{"NOSUCHCREATOR"},
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("UpdateSeries code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}

	got, err := client.GetSeries(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.GetSeriesRequest{
		Tenant:   tenant.tenantContext(),
		PublicId: publicID,
	}))
	if err != nil {
		t.Fatalf("GetSeries after failed update: %v", err)
	}
	if got.Msg.Series.Title != "Original Title" {
		t.Fatalf("title after failed update = %q, want Original Title", got.Msg.Series.Title)
	}
	if got.Msg.Series.Synopsis != "Original synopsis" {
		t.Fatalf("synopsis after failed update = %q, want Original synopsis", got.Msg.Series.Synopsis)
	}
	if len(got.Msg.Series.Creators) != 1 || got.Msg.Series.Creators[0].PublicId != creatorPublicID {
		t.Fatalf("creators after failed update = %+v, want the original creator %s", got.Msg.Series.Creators, creatorPublicID)
	}
	if count := env.countRows(t, "SELECT count(*) FROM series_creators WHERE tenant_id = $1", tenant.Tenant.ID); count != 1 {
		t.Fatalf("series_creators rows = %d, want 1 after a rejected update", count)
	}
	if count := env.countRows(t, "SELECT count(*) FROM series WHERE title = $1", "Hijacked Title"); count != 0 {
		t.Fatalf("series titled Hijacked Title = %d, want 0", count)
	}
}

func TestDBListSeriesPaginatesWithTokens(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()

	createdPublicIDs := make([]string, 0, 3)
	for _, title := range []string{"First", "Second", "Third"} {
		resp, err := client.CreateSeries(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateSeriesRequest{
			Tenant: tenant.tenantContext(),
			Title:  title + " Series",
		}))
		if err != nil {
			t.Fatalf("CreateSeries %s: %v", title, err)
		}
		createdPublicIDs = append(createdPublicIDs, resp.Msg.Series.PublicId)
	}

	first, err := client.ListSeries(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.ListSeriesRequest{
		Tenant: tenant.tenantContext(),
		Limit:  2,
	}))
	if err != nil {
		t.Fatalf("ListSeries first page: %v", err)
	}
	if len(first.Msg.Series) != 2 || first.Msg.PreviousToken != "" || first.Msg.NextToken == "" {
		t.Fatalf("first page = %d series, tokens (%q, %q); want 2, empty previous, non-empty next",
			len(first.Msg.Series), first.Msg.PreviousToken, first.Msg.NextToken)
	}

	second, err := client.ListSeries(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.ListSeriesRequest{
		Tenant: tenant.tenantContext(),
		Limit:  2,
		Token:  first.Msg.NextToken,
	}))
	if err != nil {
		t.Fatalf("ListSeries second page: %v", err)
	}
	if len(second.Msg.Series) != 1 || second.Msg.PreviousToken == "" || second.Msg.NextToken != "" {
		t.Fatalf("second page = %d series, tokens (%q, %q); want 1, non-empty previous, empty next",
			len(second.Msg.Series), second.Msg.PreviousToken, second.Msg.NextToken)
	}

	listed := append(seriesPublicIDs(first.Msg.Series), seriesPublicIDs(second.Msg.Series)...)
	slices.Sort(listed)
	slices.Sort(createdPublicIDs)
	if !slices.Equal(listed, createdPublicIDs) {
		t.Fatalf("paged public IDs = %v, want %v", listed, createdPublicIDs)
	}

	back, err := client.ListSeries(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.ListSeriesRequest{
		Tenant: tenant.tenantContext(),
		Limit:  2,
		Token:  second.Msg.PreviousToken,
	}))
	if err != nil {
		t.Fatalf("ListSeries previous page: %v", err)
	}
	if !slices.Equal(seriesPublicIDs(back.Msg.Series), seriesPublicIDs(first.Msg.Series)) {
		t.Fatalf("previous page = %v, want %v", seriesPublicIDs(back.Msg.Series), seriesPublicIDs(first.Msg.Series))
	}
}
