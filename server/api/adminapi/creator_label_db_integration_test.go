package adminapi

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
)

func TestDBCreateCreatorAndAttachToSeries(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	creators := env.creatorClient()

	created, err := creators.CreateCreator(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateCreatorRequest{
		Tenant:      tenant.tenantContext(),
		Name:        "Aoi Sakura",
		ProfileText: "Draws things",
	}))
	if err != nil {
		t.Fatalf("CreateCreator: %v", err)
	}
	creatorPublicID := created.Msg.Creator.PublicId
	if creatorPublicID == "" {
		t.Fatal("creator.public_id is empty")
	}

	series, err := env.seriesClient().CreateSeries(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateSeriesRequest{
		Tenant:           tenant.tenantContext(),
		Title:            "Series With Creator",
		CreatorPublicIds: []string{creatorPublicID},
	}))
	if err != nil {
		t.Fatalf("CreateSeries: %v", err)
	}
	if len(series.Msg.Series.Creators) != 1 || series.Msg.Series.Creators[0].PublicId != creatorPublicID {
		t.Fatalf("series creators = %+v, want the single creator %s", series.Msg.Series.Creators, creatorPublicID)
	}

	reloaded, err := env.seriesClient().GetSeries(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.GetSeriesRequest{
		Tenant:   tenant.tenantContext(),
		PublicId: series.Msg.Series.PublicId,
	}))
	if err != nil {
		t.Fatalf("GetSeries: %v", err)
	}
	if len(reloaded.Msg.Series.Creators) != 1 || reloaded.Msg.Series.Creators[0].Name != "Aoi Sakura" {
		t.Fatalf("reloaded creators = %+v, want Aoi Sakura", reloaded.Msg.Series.Creators)
	}
}

func TestDBUpdateCreatorPersists(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	creators := env.creatorClient()

	created, err := creators.CreateCreator(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateCreatorRequest{
		Tenant: tenant.tenantContext(),
		Name:   "Before Rename",
	}))
	if err != nil {
		t.Fatalf("CreateCreator: %v", err)
	}

	if _, err := creators.UpdateCreator(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UpdateCreatorRequest{
		Tenant:      tenant.tenantContext(),
		PublicId:    created.Msg.Creator.PublicId,
		Name:        "After Rename",
		ProfileText: "Updated profile",
	})); err != nil {
		t.Fatalf("UpdateCreator: %v", err)
	}

	listed, err := creators.ListCreators(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.ListCreatorsRequest{
		Tenant: tenant.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("ListCreators: %v", err)
	}
	if len(listed.Msg.Creators) != 1 || listed.Msg.Creators[0].Name != "After Rename" {
		t.Fatalf("ListCreators = %+v, want a single creator named After Rename", listed.Msg.Creators)
	}
}

func TestDBListCreatorsExcludesOtherTenants(t *testing.T) {
	env := newAdminDBEnv(t)
	first, second := seedTwoTenants(t, env)
	creators := env.creatorClient()

	if _, err := creators.CreateCreator(context.Background(), newAdminDBRequest(second, &publiraadminv1.CreateCreatorRequest{
		Tenant: second.tenantContext(),
		Name:   "Tenant B Creator",
	})); err != nil {
		t.Fatalf("CreateCreator for tenant B: %v", err)
	}

	listed, err := creators.ListCreators(context.Background(), newAdminDBRequest(first, &publiraadminv1.ListCreatorsRequest{
		Tenant: first.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("ListCreators for tenant A: %v", err)
	}
	if len(listed.Msg.Creators) != 0 {
		t.Fatalf("tenant A sees %+v, want no creators", listed.Msg.Creators)
	}
}

func TestDBSeriesRejectsCreatorFromAnotherTenant(t *testing.T) {
	env := newAdminDBEnv(t)
	first, second := seedTwoTenants(t, env)

	theirCreator, err := env.creatorClient().CreateCreator(context.Background(), newAdminDBRequest(second, &publiraadminv1.CreateCreatorRequest{
		Tenant: second.tenantContext(),
		Name:   "Tenant B Creator",
	}))
	if err != nil {
		t.Fatalf("CreateCreator for tenant B: %v", err)
	}

	_, err = env.seriesClient().CreateSeries(context.Background(), newAdminDBRequest(first, &publiraadminv1.CreateSeriesRequest{
		Tenant:           first.tenantContext(),
		Title:            "Series Borrowing A Creator",
		CreatorPublicIds: []string{theirCreator.Msg.Creator.PublicId},
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("CreateSeries code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}

	// The series row is written before creators are resolved, so the failure must
	// not leave the link behind even though the series itself may exist.
	if count := env.countRows(t, "SELECT count(*) FROM series_creators"); count != 0 {
		t.Fatalf("series_creators rows = %d, want 0", count)
	}
}

func TestDBCreateLabelAndAssignToSeries(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")

	label, err := env.labelClient().CreateLabel(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateLabelRequest{
		Tenant: tenant.tenantContext(),
		Name:   "Shonen",
	}))
	if err != nil {
		t.Fatalf("CreateLabel: %v", err)
	}

	series, err := env.seriesClient().CreateSeries(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateSeriesRequest{
		Tenant:        tenant.tenantContext(),
		Title:         "Labelled Series",
		LabelPublicId: label.Msg.Label.PublicId,
	}))
	if err != nil {
		t.Fatalf("CreateSeries: %v", err)
	}
	if series.Msg.Series.Label == nil || series.Msg.Series.Label.PublicId != label.Msg.Label.PublicId {
		t.Fatalf("series label = %+v, want %s", series.Msg.Series.Label, label.Msg.Label.PublicId)
	}
	if series.Msg.Series.Label.Name != "Shonen" {
		t.Fatalf("series label name = %q, want Shonen", series.Msg.Series.Label.Name)
	}
}

func TestDBSeriesRejectsLabelFromAnotherTenant(t *testing.T) {
	env := newAdminDBEnv(t)
	first, second := seedTwoTenants(t, env)

	theirLabel, err := env.labelClient().CreateLabel(context.Background(), newAdminDBRequest(second, &publiraadminv1.CreateLabelRequest{
		Tenant: second.tenantContext(),
		Name:   "Tenant B Label",
	}))
	if err != nil {
		t.Fatalf("CreateLabel for tenant B: %v", err)
	}

	_, err = env.seriesClient().CreateSeries(context.Background(), newAdminDBRequest(first, &publiraadminv1.CreateSeriesRequest{
		Tenant:        first.tenantContext(),
		Title:         "Series Borrowing A Label",
		LabelPublicId: theirLabel.Msg.Label.PublicId,
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("CreateSeries code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	if count := env.countRows(t, "SELECT count(*) FROM series"); count != 0 {
		t.Fatalf("series rows = %d, want 0", count)
	}
}
