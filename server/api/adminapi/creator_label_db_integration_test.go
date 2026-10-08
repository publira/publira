package adminapi

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"

	"connectrpc.com/connect/v2"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/storage"
	"github.com/publira/publira/server/internal/testutil"
)

func TestDBCreateCreatorAndAttachToSeries(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	creators := env.creatorClient()

	created, err := creators.CreateCreator(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateCreatorRequest{
		Tenant:      tenant.tenantContext(),
		Name:        "Aoi Sakura",
		ProfileText: "Draws things",
	})
	if err != nil {
		t.Fatalf("CreateCreator: %v", err)
	}
	creatorPublicID := created.Creator.PublicId
	if creatorPublicID == "" {
		t.Fatal("creator.public_id is empty")
	}

	series, err := env.seriesClient().CreateSeries(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateSeriesRequest{
		Tenant:         tenant.tenantContext(),
		Title:          "Series With Creator",
		CreatorCredits: env.creatorCredits(t, tenant, created.Creator.Id),
	})
	if err != nil {
		t.Fatalf("CreateSeries: %v", err)
	}
	if len(series.Series.Creators) != 1 || series.Series.Creators[0].PublicId != creatorPublicID {
		t.Fatalf("series creators = %+v, want the single creator %s", series.Series.Creators, creatorPublicID)
	}

	reloaded, err := env.seriesClient().GetSeries(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.GetSeriesRequest{
		Tenant:   tenant.tenantContext(),
		PublicId: series.Series.PublicId,
	})
	if err != nil {
		t.Fatalf("GetSeries: %v", err)
	}
	if len(reloaded.Series.Creators) != 1 || reloaded.Series.Creators[0].Name != "Aoi Sakura" {
		t.Fatalf("reloaded creators = %+v, want Aoi Sakura", reloaded.Series.Creators)
	}
}

func TestDBUpdateCreatorPersists(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	creators := env.creatorClient()

	created, err := creators.CreateCreator(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateCreatorRequest{
		Tenant: tenant.tenantContext(),
		Name:   "Before Rename",
	})
	if err != nil {
		t.Fatalf("CreateCreator: %v", err)
	}

	if _, err := creators.UpdateCreator(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.UpdateCreatorRequest{
		Tenant:      tenant.tenantContext(),
		CreatorId:   created.Creator.Id,
		Name:        "After Rename",
		ProfileText: "Updated profile",
	}); err != nil {
		t.Fatalf("UpdateCreator: %v", err)
	}

	listed, err := creators.ListCreators(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.ListCreatorsRequest{
		Tenant: tenant.tenantContext(),
	})
	if err != nil {
		t.Fatalf("ListCreators: %v", err)
	}
	if len(listed.Creators) != 1 || listed.Creators[0].Name != "After Rename" {
		t.Fatalf("ListCreators = %+v, want a single creator named After Rename", listed.Creators)
	}
}

func TestDBListCreatorsExcludesOtherTenants(t *testing.T) {
	env := newAdminDBEnv(t)
	first, second := seedTwoTenants(t, env)
	creators := env.creatorClient()

	if _, err := creators.CreateCreator(testutil.WithBearer(context.Background(), second.token()), &publiraadminv1.CreateCreatorRequest{
		Tenant: second.tenantContext(),
		Name:   "Tenant B Creator",
	}); err != nil {
		t.Fatalf("CreateCreator for tenant B: %v", err)
	}

	listed, err := creators.ListCreators(testutil.WithBearer(context.Background(), first.token()), &publiraadminv1.ListCreatorsRequest{
		Tenant: first.tenantContext(),
	})
	if err != nil {
		t.Fatalf("ListCreators for tenant A: %v", err)
	}
	if len(listed.Creators) != 0 {
		t.Fatalf("tenant A sees %+v, want no creators", listed.Creators)
	}
}

func TestDBGetCreatorOfAnotherTenantReturnsNotFound(t *testing.T) {
	env := newAdminDBEnv(t)
	first, second := seedTwoTenants(t, env)
	creators := env.creatorClient()

	mine, err := creators.CreateCreator(testutil.WithBearer(context.Background(), first.token()), &publiraadminv1.CreateCreatorRequest{
		Tenant:      first.tenantContext(),
		Name:        "Tenant A Creator",
		ProfileText: "Profile A",
	})
	if err != nil {
		t.Fatalf("CreateCreator for tenant A: %v", err)
	}
	theirs, err := creators.CreateCreator(testutil.WithBearer(context.Background(), second.token()), &publiraadminv1.CreateCreatorRequest{
		Tenant: second.tenantContext(),
		Name:   "Tenant B Creator",
	})
	if err != nil {
		t.Fatalf("CreateCreator for tenant B: %v", err)
	}

	got, err := creators.GetCreator(testutil.WithBearer(context.Background(), first.token()), &publiraadminv1.GetCreatorRequest{
		Tenant:   first.tenantContext(),
		PublicId: mine.Creator.PublicId,
	})
	if err != nil {
		t.Fatalf("GetCreator: %v", err)
	}
	if got.Creator.Name != "Tenant A Creator" || got.Creator.ProfileText != "Profile A" {
		t.Fatalf("GetCreator = %+v, want name/profile of %+v", got.Creator, mine.Creator)
	}

	_, err = creators.GetCreator(testutil.WithBearer(context.Background(), first.token()), &publiraadminv1.GetCreatorRequest{
		Tenant:   first.tenantContext(),
		PublicId: theirs.Creator.PublicId,
	})
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetCreator across tenants code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
}

func TestDBGetLabelOfAnotherTenantReturnsNotFound(t *testing.T) {
	env := newAdminDBEnv(t)
	first, second := seedTwoTenants(t, env)
	labels := env.labelClient()

	mine, err := labels.CreateLabel(testutil.WithBearer(context.Background(), first.token()), &publiraadminv1.CreateLabelRequest{
		Tenant: first.tenantContext(),
		Name:   "Tenant A Label",
	})
	if err != nil {
		t.Fatalf("CreateLabel for tenant A: %v", err)
	}
	theirs, err := labels.CreateLabel(testutil.WithBearer(context.Background(), second.token()), &publiraadminv1.CreateLabelRequest{
		Tenant: second.tenantContext(),
		Name:   "Tenant B Label",
	})
	if err != nil {
		t.Fatalf("CreateLabel for tenant B: %v", err)
	}

	got, err := labels.GetLabel(testutil.WithBearer(context.Background(), first.token()), &publiraadminv1.GetLabelRequest{
		Tenant:   first.tenantContext(),
		PublicId: mine.Label.PublicId,
	})
	if err != nil {
		t.Fatalf("GetLabel: %v", err)
	}
	if got.Label.Name != "Tenant A Label" {
		t.Fatalf("GetLabel = %+v, want name of %+v", got.Label, mine.Label)
	}

	_, err = labels.GetLabel(testutil.WithBearer(context.Background(), first.token()), &publiraadminv1.GetLabelRequest{
		Tenant:   first.tenantContext(),
		PublicId: theirs.Label.PublicId,
	})
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetLabel across tenants code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
}

func TestDBSeriesRejectsCreatorFromAnotherTenant(t *testing.T) {
	env := newAdminDBEnv(t)
	first, second := seedTwoTenants(t, env)

	theirCreator, err := env.creatorClient().CreateCreator(testutil.WithBearer(context.Background(), second.token()), &publiraadminv1.CreateCreatorRequest{
		Tenant: second.tenantContext(),
		Name:   "Tenant B Creator",
	})
	if err != nil {
		t.Fatalf("CreateCreator for tenant B: %v", err)
	}

	_, err = env.seriesClient().CreateSeries(testutil.WithBearer(context.Background(), first.token()), &publiraadminv1.CreateSeriesRequest{
		Tenant:         first.tenantContext(),
		Title:          "Series Borrowing A Creator",
		CreatorCredits: env.creatorCredits(t, first, theirCreator.Creator.Id),
	})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("CreateSeries code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}

	// The link must not exist. The creators are resolved before the write
	// transaction opens, so a rejected create leaves nothing behind at all, and
	// this assertion holds however that resolution is ordered.
	if count := env.countRows(t, "SELECT count(*) FROM series_creators"); count != 0 {
		t.Fatalf("series_creators rows = %d, want 0", count)
	}
}

func TestDBCreateLabelAndAssignToSeries(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")

	label, err := env.labelClient().CreateLabel(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateLabelRequest{
		Tenant: tenant.tenantContext(),
		Name:   "Shonen",
	})
	if err != nil {
		t.Fatalf("CreateLabel: %v", err)
	}

	series, err := env.seriesClient().CreateSeries(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateSeriesRequest{
		Tenant:  tenant.tenantContext(),
		Title:   "Labelled Series",
		LabelId: label.Label.Id,
	})
	if err != nil {
		t.Fatalf("CreateSeries: %v", err)
	}
	if series.Series.Label == nil || series.Series.Label.PublicId != label.Label.PublicId {
		t.Fatalf("series label = %+v, want %s", series.Series.Label, label.Label.PublicId)
	}
	if series.Series.Label.Name != "Shonen" {
		t.Fatalf("series label name = %q, want Shonen", series.Series.Label.Name)
	}
}

func TestDBSeriesRejectsLabelFromAnotherTenant(t *testing.T) {
	env := newAdminDBEnv(t)
	first, second := seedTwoTenants(t, env)

	theirLabel, err := env.labelClient().CreateLabel(testutil.WithBearer(context.Background(), second.token()), &publiraadminv1.CreateLabelRequest{
		Tenant: second.tenantContext(),
		Name:   "Tenant B Label",
	})
	if err != nil {
		t.Fatalf("CreateLabel for tenant B: %v", err)
	}

	_, err = env.seriesClient().CreateSeries(testutil.WithBearer(context.Background(), first.token()), &publiraadminv1.CreateSeriesRequest{
		Tenant:  first.tenantContext(),
		Title:   "Series Borrowing A Label",
		LabelId: theirLabel.Label.Id,
	})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("CreateSeries code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	if count := env.countRows(t, "SELECT count(*) FROM series"); count != 0 {
		t.Fatalf("series rows = %d, want 0", count)
	}
}

// refusingStorageProvider refuses every upload while refuse is set, the way an
// object store that is down does, and accepts them again once it is cleared.
type refusingStorageProvider struct {
	testStorageProvider
	refuse atomic.Bool
}

func (p *refusingStorageProvider) Upload(ctx context.Context, req storage.UploadRequest) (storage.UploadResult, error) {
	if p.refuse.Load() {
		return storage.UploadResult{}, errors.New("object store unavailable")
	}
	return p.testStorageProvider.Upload(ctx, req)
}

// A create that fails on its eye-catch must not leave the label behind, or the
// editor's retry makes a second label of the same name.
func TestDBCreateLabelWithAnUnusableImageLeavesNoLabel(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	labels := env.labelClient()

	request := func(image []byte) *publiraadminv1.CreateLabelRequest {
		return &publiraadminv1.CreateLabelRequest{
			Tenant:                   tenant.tenantContext(),
			Name:                     "Shonen",
			EyeCatchImageData:        image,
			EyeCatchImageContentType: "image/jpeg",
		}
	}

	if _, err := labels.CreateLabel(testutil.WithBearer(context.Background(), tenant.token()), request(aspectJPEG(t, 600, 800))); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("CreateLabel with a small image error = %v, want invalid_argument", err)
	}
	if count := env.countRows(t, "SELECT count(*) FROM labels WHERE tenant_id = $1", tenant.Tenant.ID); count != 0 {
		t.Fatalf("labels after the refused create = %d, want 0", count)
	}
	if count := env.countRows(t, "SELECT count(*) FROM label_images WHERE tenant_id = $1", tenant.Tenant.ID); count != 0 {
		t.Fatalf("label_images after the refused create = %d, want 0", count)
	}

	created, err := labels.CreateLabel(testutil.WithBearer(context.Background(), tenant.token()), request(aspectJPEG(t, 2400, 3200)))
	if err != nil {
		t.Fatalf("CreateLabel with a usable image: %v", err)
	}
	if got := len(created.Label.GetEyeCatchImageVariants()); got != eyeCatchVariantCount {
		t.Fatalf("created variants = %d, want %d", got, eyeCatchVariantCount)
	}
	if count := env.countRows(t, "SELECT count(*) FROM labels WHERE tenant_id = $1", tenant.Tenant.ID); count != 1 {
		t.Fatalf("labels after the retry = %d, want 1", count)
	}
}

// A create whose eye-catch the object store refuses part-way must not leave
// the label or its image rows behind.
func TestDBCreateLabelWhoseEyeCatchTheStoreRefusesLeavesNoLabel(t *testing.T) {
	store := &refusingStorageProvider{}
	store.refuse.Store(true)
	env := newAdminDBEnvWithStorage(t, store)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	labels := env.labelClient()

	request := func() *publiraadminv1.CreateLabelRequest {
		return &publiraadminv1.CreateLabelRequest{
			Tenant:                   tenant.tenantContext(),
			Name:                     "Shonen",
			EyeCatchImageData:        aspectJPEG(t, 2400, 3200),
			EyeCatchImageContentType: "image/jpeg",
		}
	}

	if _, err := labels.CreateLabel(testutil.WithBearer(context.Background(), tenant.token()), request()); connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("CreateLabel with the store refusing error = %v, want internal", err)
	}
	if count := env.countRows(t, "SELECT count(*) FROM labels WHERE tenant_id = $1", tenant.Tenant.ID); count != 0 {
		t.Fatalf("labels after the refused create = %d, want 0", count)
	}
	if count := env.countRows(t, "SELECT count(*) FROM label_images WHERE tenant_id = $1", tenant.Tenant.ID); count != 0 {
		t.Fatalf("label_images after the refused create = %d, want 0", count)
	}

	store.refuse.Store(false)
	if _, err := labels.CreateLabel(testutil.WithBearer(context.Background(), tenant.token()), request()); err != nil {
		t.Fatalf("CreateLabel once the store accepts: %v", err)
	}
	if count := env.countRows(t, "SELECT count(*) FROM labels WHERE tenant_id = $1", tenant.Tenant.ID); count != 1 {
		t.Fatalf("labels after the retry = %d, want 1", count)
	}
}

// An update that fails on its eye-catch keeps the label as it was and leaves no
// image row that nothing points at.
func TestDBUpdateLabelWithAnUnusableImageLeavesNoImage(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	labels := env.labelClient()

	created, err := labels.CreateLabel(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateLabelRequest{
		Tenant: tenant.tenantContext(),
		Name:   "Shonen",
	})
	if err != nil {
		t.Fatalf("CreateLabel: %v", err)
	}

	_, err = labels.UpdateLabel(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.UpdateLabelRequest{
		Tenant:                   tenant.tenantContext(),
		LabelId:                  created.Label.Id,
		Name:                     "Seinen",
		EyeCatchImageData:        aspectJPEG(t, 600, 800),
		EyeCatchImageContentType: "image/jpeg",
	})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("UpdateLabel with a small image error = %v, want invalid_argument", err)
	}
	if count := env.countRows(t, "SELECT count(*) FROM label_images WHERE tenant_id = $1", tenant.Tenant.ID); count != 0 {
		t.Fatalf("label_images after the refused update = %d, want 0", count)
	}
	if count := env.countRows(t, "SELECT count(*) FROM labels WHERE tenant_id = $1 AND name = 'Shonen'", tenant.Tenant.ID); count != 1 {
		t.Fatalf("labels still named Shonen = %d, want 1", count)
	}
}

// A create whose icon the object store refuses must not leave the creator
// behind, or the editor's retry makes a second author of the same name.
func TestDBCreateCreatorWhoseIconTheStoreRefusesLeavesNoCreator(t *testing.T) {
	store := &refusingStorageProvider{}
	store.refuse.Store(true)
	env := newAdminDBEnvWithStorage(t, store)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	creators := env.creatorClient()

	request := func() *publiraadminv1.CreateCreatorRequest {
		return &publiraadminv1.CreateCreatorRequest{
			Tenant:               tenant.tenantContext(),
			Name:                 "Aoi Sakura",
			IconImageData:        aspectJPEG(t, 300, 300),
			IconImageContentType: "image/jpeg",
		}
	}

	if _, err := creators.CreateCreator(testutil.WithBearer(context.Background(), tenant.token()), request()); connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("CreateCreator with the store refusing error = %v, want internal", err)
	}
	if count := env.countRows(t, "SELECT count(*) FROM creators WHERE tenant_id = $1", tenant.Tenant.ID); count != 0 {
		t.Fatalf("creators after the refused create = %d, want 0", count)
	}
	if count := env.countRows(t, "SELECT count(*) FROM creator_images WHERE tenant_id = $1", tenant.Tenant.ID); count != 0 {
		t.Fatalf("creator_images after the refused create = %d, want 0", count)
	}

	store.refuse.Store(false)
	created, err := creators.CreateCreator(testutil.WithBearer(context.Background(), tenant.token()), request())
	if err != nil {
		t.Fatalf("CreateCreator once the store accepts: %v", err)
	}
	if created.Creator.GetIconImageUrl() == "" {
		t.Fatal("created creator has no icon")
	}
	if count := env.countRows(t, "SELECT count(*) FROM creators WHERE tenant_id = $1", tenant.Tenant.ID); count != 1 {
		t.Fatalf("creators after the retry = %d, want 1", count)
	}
}

// An update whose icon the object store refuses keeps the author as it was and
// leaves no image row that nothing points at.
func TestDBUpdateCreatorWhoseIconTheStoreRefusesLeavesNoImage(t *testing.T) {
	store := &refusingStorageProvider{}
	env := newAdminDBEnvWithStorage(t, store)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	creators := env.creatorClient()

	created, err := creators.CreateCreator(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateCreatorRequest{
		Tenant: tenant.tenantContext(),
		Name:   "Aoi Sakura",
	})
	if err != nil {
		t.Fatalf("CreateCreator: %v", err)
	}

	store.refuse.Store(true)
	_, err = creators.UpdateCreator(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.UpdateCreatorRequest{
		Tenant:               tenant.tenantContext(),
		CreatorId:            created.Creator.Id,
		Name:                 "Sakura Aoi",
		IconImageData:        aspectJPEG(t, 300, 300),
		IconImageContentType: "image/jpeg",
	})
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("UpdateCreator with the store refusing error = %v, want internal", err)
	}
	if count := env.countRows(t, "SELECT count(*) FROM creator_images WHERE tenant_id = $1", tenant.Tenant.ID); count != 0 {
		t.Fatalf("creator_images after the refused update = %d, want 0", count)
	}
	if count := env.countRows(t, "SELECT count(*) FROM creators WHERE tenant_id = $1 AND name = 'Aoi Sakura'", tenant.Tenant.ID); count != 1 {
		t.Fatalf("creators still named Aoi Sakura = %d, want 1", count)
	}
}
