package adminapi

import (
	"context"
	"slices"
	"testing"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/testutil"
	"github.com/publira/publira/server/internal/usericon"
)

func (e *adminDBEnv) uploadReaderIconPreset(t *testing.T, tenant adminDBTenant) *publirattypesv1.ReaderIconPreset {
	t.Helper()

	res, err := e.tenantSettingsClient().UploadReaderIconPreset(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.UploadReaderIconPresetRequest{
		Tenant:          tenant.tenantContext(),
		IconData:        brandingSourcePNG(t, 300, 200),
		IconContentType: "image/png",
	})
	if err != nil {
		t.Fatalf("UploadReaderIconPreset: %v", err)
	}
	return res.Preset
}

func (e *adminDBEnv) listReaderIconPresets(t *testing.T, tenant adminDBTenant) []*publirattypesv1.ReaderIconPreset {
	t.Helper()

	res, err := e.tenantSettingsClient().ListReaderIconPresets(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.ListReaderIconPresetsRequest{
		Tenant: tenant.tenantContext(),
	})
	if err != nil {
		t.Fatalf("ListReaderIconPresets: %v", err)
	}
	return res.Presets
}

func (e *adminDBEnv) updateReaderIconPolicy(t *testing.T, tenant adminDBTenant, policy publirattypesv1.ReaderIconPolicy) publirattypesv1.ReaderIconPolicy {
	t.Helper()

	res, err := e.tenantSettingsClient().UpdateTenantReaderIconPolicy(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.UpdateTenantReaderIconPolicyRequest{
		Tenant: tenant.tenantContext(),
		Policy: policy,
	})
	if err != nil {
		t.Fatalf("UpdateTenantReaderIconPolicy %s: %v", policy, err)
	}
	return res.Policy
}

// electReaderIconPreset elects a preset for the account the way the reader's
// own SelectMyIcon does.
func (e *adminDBEnv) electReaderIconPreset(t *testing.T, tenant testutil.Tenant, reader testutil.TenantUser, presetID string) {
	t.Helper()

	if err := usericon.SelectPreset(context.Background(), dbmodels.New(e.PG.DB), tenant.ID, reader.ID, uuid.MustParse(presetID)); err != nil {
		t.Fatalf("usericon.SelectPreset: %v", err)
	}
}

// A tenant that has saved nothing lets readers upload, and a save is read back
// as it was stored.
func TestDBReaderIconPolicyDefaultsToUploadAndReadsBackWhatWasSaved(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "RIPTENANT01", "reader-icon-policy.example.com", "Policy", "RIPADMIN001", "admin@reader-icon-policy.example.com")
	ctx := testutil.WithBearer(context.Background(), tenant.token())

	get := func() publirattypesv1.ReaderIconPolicy {
		t.Helper()
		res, err := env.tenantSettingsClient().GetTenantReaderIconPolicy(ctx, &publiraadminv1.GetTenantReaderIconPolicyRequest{Tenant: tenant.tenantContext()})
		if err != nil {
			t.Fatalf("GetTenantReaderIconPolicy: %v", err)
		}
		return res.Policy
	}
	if got := get(); got != publirattypesv1.ReaderIconPolicy_READER_ICON_POLICY_UPLOAD {
		t.Fatalf("policy of a tenant that saved nothing = %s, want UPLOAD", got)
	}
	for _, policy := range []publirattypesv1.ReaderIconPolicy{
		publirattypesv1.ReaderIconPolicy_READER_ICON_POLICY_PRESET,
		publirattypesv1.ReaderIconPolicy_READER_ICON_POLICY_DISABLED,
		publirattypesv1.ReaderIconPolicy_READER_ICON_POLICY_UPLOAD,
	} {
		if saved := env.updateReaderIconPolicy(t, tenant, policy); saved != policy {
			t.Fatalf("UpdateTenantReaderIconPolicy %s answered %s", policy, saved)
		}
		if got := get(); got != policy {
			t.Fatalf("policy after saving %s = %s", policy, got)
		}
	}

	_, err := env.tenantSettingsClient().UpdateTenantReaderIconPolicy(ctx, &publiraadminv1.UpdateTenantReaderIconPolicyRequest{Tenant: tenant.tenantContext()})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("UpdateTenantReaderIconPolicy with no policy = %v, want invalid_argument", err)
	}
}

// Narrowing the policy clears exactly the icons it no longer allows, and owes
// a drop of the comment lists that showed them; widening it clears nothing.
func TestDBReaderIconPolicyChangeClearsTheIconsItNoLongerAllows(t *testing.T) {
	env := newReaderIconDBEnv(t)
	fixture := newCommentModerationFixture(t, env, "RPC", "reader-icon-policy-clear.example.com")
	tenant := fixture.admin
	uploader := testutil.TenantUser{ID: fixture.reader, PublicID: fixture.readerPublicID}
	picker := env.PG.SeedEndUser(t, tenant.Tenant.ID, "RPCPICKER01", "picker@reader-icon-policy-clear.example.com", "Picker")
	fixture.seedComment(t, "RPCCOMMENT1", "published")

	env.seedReaderIcon(t, tenant.Tenant, uploader)
	preset := env.uploadReaderIconPreset(t, tenant)
	env.electReaderIconPreset(t, tenant.Tenant, picker, preset.Id)

	iconOf := func(reader testutil.TenantUser) string {
		t.Helper()
		return readerIconURL(t, env.getReader(t, tenant, reader.PublicID).IconImageVariants)
	}
	if got := iconOf(picker); got != preset.Variants[0].Url {
		t.Fatalf("icon of the reader who picked the preset = %q, want %q", got, preset.Variants[0].Url)
	}

	env.updateReaderIconPolicy(t, tenant, publirattypesv1.ReaderIconPolicy_READER_ICON_POLICY_PRESET)
	if got := iconOf(uploader); got != "" {
		t.Fatalf("uploaded icon under the preset policy = %q, want it cleared", got)
	}
	if got := iconOf(picker); got != preset.Variants[0].Url {
		t.Fatalf("preset icon under the preset policy = %q, want %q kept", got, preset.Variants[0].Url)
	}
	wantTag := commentListRevalidateTag(tenant.Tenant.ID, fixture.episode.PublicID)
	if tags := env.revalidatedTags(t, tenant.Tenant); !slices.Contains(tags, wantTag) {
		t.Fatalf("recorded invalidations = %v, want %s for the uploader's comment", tags, wantTag)
	}
	// The cleared upload is left for the orphan sweep rather than deleted.
	if count := env.countRows(t, "SELECT count(*) FROM user_images WHERE user_id = $1", uploader.ID); count != 1 {
		t.Fatalf("user_images rows after the clear = %d, want the one image left for the orphan sweep", count)
	}

	env.updateReaderIconPolicy(t, tenant, publirattypesv1.ReaderIconPolicy_READER_ICON_POLICY_UPLOAD)
	if got := iconOf(picker); got != preset.Variants[0].Url {
		t.Fatalf("preset icon after widening the policy = %q, want %q kept", got, preset.Variants[0].Url)
	}

	env.updateReaderIconPolicy(t, tenant, publirattypesv1.ReaderIconPolicy_READER_ICON_POLICY_DISABLED)
	if got := iconOf(picker); got != "" {
		t.Fatalf("preset icon under the disabled policy = %q, want it cleared", got)
	}
	if presets := env.listReaderIconPresets(t, tenant); len(presets) != 1 || presets[0].Id != preset.Id {
		t.Fatalf("presets after disabling icons = %v, want %s kept", presets, preset.Id)
	}
}

// takeRevalidatedTags answers the cache tags the tenant's writes have recorded
// an invalidation of since the last take, so each write is checked on its own.
func (e *adminDBEnv) takeRevalidatedTags(t *testing.T, tenant testutil.Tenant) []string {
	t.Helper()

	tags := e.revalidatedTags(t, tenant)
	if _, err := e.PG.DB.ExecContext(context.Background(),
		`DELETE FROM outbox_events WHERE tenant_id = $1 AND event_type = $2`,
		tenant.ID, outbox.EventTypeNextCacheRevalidation,
	); err != nil {
		t.Fatalf("clear cache invalidations: %v", err)
	}
	return tags
}

// Every change to the policy or the presets drops the storefront's cache of
// the site settings it reads them under, and saving the policy the tenant
// already has changes nothing and drops nothing.
func TestDBReaderIconSettingsRevalidateTheSiteSettings(t *testing.T) {
	env := newReaderIconDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "RIVTENANT01", "reader-icon-revalidate.example.com", "Revalidate", "RIVADMIN001", "admin@reader-icon-revalidate.example.com")
	siteTag := "tenant:" + tenant.Tenant.ID.String() + ":site"
	want := func(write string, want []string) {
		t.Helper()
		if got := env.takeRevalidatedTags(t, tenant.Tenant); !slices.Equal(got, want) {
			t.Fatalf("invalidations recorded by %s = %v, want %v", write, got, want)
		}
	}

	preset := env.uploadReaderIconPreset(t, tenant)
	want("UploadReaderIconPreset", []string{siteTag})

	env.updateReaderIconPolicy(t, tenant, publirattypesv1.ReaderIconPolicy_READER_ICON_POLICY_PRESET)
	want("UpdateTenantReaderIconPolicy", []string{siteTag})

	env.updateReaderIconPolicy(t, tenant, publirattypesv1.ReaderIconPolicy_READER_ICON_POLICY_PRESET)
	want("UpdateTenantReaderIconPolicy to the policy already saved", nil)

	if _, err := env.tenantSettingsClient().DeleteReaderIconPreset(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.DeleteReaderIconPresetRequest{
		Tenant:   tenant.tenantContext(),
		PresetId: preset.Id,
	}); err != nil {
		t.Fatalf("DeleteReaderIconPreset: %v", err)
	}
	want("DeleteReaderIconPreset", []string{siteTag})
}

// A preset is stored the way a reader's upload is, listed with its variants,
// and deleting it leaves every reader who picked it with no icon.
func TestDBReaderIconPresetUploadListAndDelete(t *testing.T) {
	env := newReaderIconDBEnv(t)
	fixture := newCommentModerationFixture(t, env, "RIS", "reader-icon-preset.example.com")
	tenant := fixture.admin
	picker := testutil.TenantUser{ID: fixture.reader, PublicID: fixture.readerPublicID}
	fixture.seedComment(t, "RISCOMMENT1", "published")

	first := env.uploadReaderIconPreset(t, tenant)
	second := env.uploadReaderIconPreset(t, tenant)
	if len(first.Variants) != 1 || first.Variants[0].Width != 200 || first.Variants[0].Height != 200 || first.CreatedAt == "" {
		t.Fatalf("uploaded preset = %v, want the 200 px square cut from the centre", first)
	}
	if want := "/images/reader-icon-presets/" + first.Id; first.Variants[0].Url != want {
		t.Fatalf("preset URL = %q, want %q", first.Variants[0].Url, want)
	}
	presets := env.listReaderIconPresets(t, tenant)
	if len(presets) != 2 || presets[0].Id != first.Id || presets[1].Id != second.Id {
		t.Fatalf("presets = %v, want %s then %s", presets, first.Id, second.Id)
	}
	if key := env.countRows(t, "SELECT count(*) FROM reader_icon_preset_variants WHERE reader_icon_preset_id = $1 AND object_key LIKE $2", uuid.MustParse(first.Id), "tenants/"+tenant.Tenant.PublicID+"/reader-icon-presets/%"); key != 1 {
		t.Fatal("the preset's object is not stored under the tenant prefix the orphan sweep walks")
	}

	env.electReaderIconPreset(t, tenant.Tenant, picker, first.Id)
	if _, err := env.tenantSettingsClient().DeleteReaderIconPreset(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.DeleteReaderIconPresetRequest{
		Tenant:   tenant.tenantContext(),
		PresetId: first.Id,
	}); err != nil {
		t.Fatalf("DeleteReaderIconPreset: %v", err)
	}
	if got := readerIconURL(t, env.getReader(t, tenant, picker.PublicID).IconImageVariants); got != "" {
		t.Fatalf("icon of the reader who picked the deleted preset = %q, want none", got)
	}
	if presets := env.listReaderIconPresets(t, tenant); len(presets) != 1 || presets[0].Id != second.Id {
		t.Fatalf("presets after the delete = %v, want %s alone", presets, second.Id)
	}
	if count := env.countRows(t, "SELECT count(*) FROM reader_icon_preset_variants WHERE reader_icon_preset_id = $1", uuid.MustParse(first.Id)); count != 0 {
		t.Fatalf("variants of the deleted preset = %d, want none left to protect its object", count)
	}
	wantTag := commentListRevalidateTag(tenant.Tenant.ID, fixture.episode.PublicID)
	if tags := env.revalidatedTags(t, tenant.Tenant); !slices.Contains(tags, wantTag) {
		t.Fatalf("recorded invalidations = %v, want %s for the picker's comment", tags, wantTag)
	}

	for _, presetID := range []string{first.Id, uuid.Must(uuid.NewV7()).String(), "not-a-uuid"} {
		if _, err := env.tenantSettingsClient().DeleteReaderIconPreset(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.DeleteReaderIconPresetRequest{
			Tenant:   tenant.tenantContext(),
			PresetId: presetID,
		}); connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("DeleteReaderIconPreset %q = %v, want not_found", presetID, err)
		}
	}

	for action, want := range map[string]int{"tenant_reader_icon_preset_uploaded": 2, "tenant_reader_icon_preset_deleted": 1} {
		if got := tenantSettingAuditCount(t, env, tenant, action, "tenant_reader_icon_presets"); got != want {
			t.Fatalf("%s audit entries = %d, want %d", action, got, want)
		}
	}
}

// A preset of another tenant is not one this tenant can delete.
func TestDBReaderIconPresetDeleteLeavesOtherTenantsAlone(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "RIQTENANT01", "reader-icon-preset-scope.example.com", "Scope", "RIQADMIN001", "admin@reader-icon-preset-scope.example.com")
	other := env.seedTenantWithAdmin(t, "RIYTENANT01", "reader-icon-preset-other.example.com", "Other", "RIYADMIN001", "admin@reader-icon-preset-other.example.com")
	preset := env.uploadReaderIconPreset(t, other)

	if _, err := env.tenantSettingsClient().DeleteReaderIconPreset(testutil.WithBearer(context.Background(), admin.token()), &publiraadminv1.DeleteReaderIconPresetRequest{
		Tenant:   admin.tenantContext(),
		PresetId: preset.Id,
	}); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("DeleteReaderIconPreset of another tenant's preset = %v, want not_found", err)
	}
	if presets := env.listReaderIconPresets(t, other); len(presets) != 1 {
		t.Fatalf("other tenant's presets = %v, want its one preset untouched", presets)
	}
	if presets := env.listReaderIconPresets(t, admin); len(presets) != 0 {
		t.Fatalf("presets = %v, want none listed from another tenant", presets)
	}
}

// A tenant holds at most maxReaderIconPresets, so the picker that lists all of
// them stays one a reader can choose from.
func TestDBReaderIconPresetUploadRefusesPastTheLimit(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "RILTENANT01", "reader-icon-preset-limit.example.com", "Limit", "RILADMIN001", "admin@reader-icon-preset-limit.example.com")
	for range maxReaderIconPresets {
		if _, err := usericon.StorePreset(context.Background(), dbmodels.New(env.PG.DB), &testStorageProvider{}, tenant.Tenant.ID, tenant.Tenant.PublicID, usericon.Upload{
			Data:        brandingSourcePNG(t, 128, 128),
			ContentType: "image/png",
		}); err != nil {
			t.Fatalf("usericon.StorePreset: %v", err)
		}
	}

	_, err := env.tenantSettingsClient().UploadReaderIconPreset(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.UploadReaderIconPresetRequest{
		Tenant:          tenant.tenantContext(),
		IconData:        brandingSourcePNG(t, 128, 128),
		IconContentType: "image/png",
	})
	if reason := errorInfoReason(t, err); connect.CodeOf(err) != connect.CodeFailedPrecondition || reason != rpcerrors.ReasonReaderIconPresetLimit {
		t.Fatalf("UploadReaderIconPreset past the limit = %v (reason %q), want failed_precondition %s", err, reason, rpcerrors.ReasonReaderIconPresetLimit)
	}
	if count := env.countRows(t, "SELECT count(*) FROM reader_icon_presets WHERE tenant_id = $1", tenant.Tenant.ID); count != maxReaderIconPresets {
		t.Fatalf("presets = %d, want %d", count, maxReaderIconPresets)
	}
}

func TestDBReaderIconPresetUploadRefusesAnUploadItCannotStore(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "RIBTENANT01", "reader-icon-preset-bad.example.com", "Bad", "RIBADMIN001", "admin@reader-icon-preset-bad.example.com")

	for name, req := range map[string]*publiraadminv1.UploadReaderIconPresetRequest{
		"not an image":         {IconData: []byte("plain text"), IconContentType: "text/plain"},
		"smaller than an icon": {IconData: brandingSourcePNG(t, 64, 64), IconContentType: "image/png"},
	} {
		req.Tenant = tenant.tenantContext()
		_, err := env.tenantSettingsClient().UploadReaderIconPreset(testutil.WithBearer(context.Background(), tenant.token()), req)
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("UploadReaderIconPreset %s = %v, want invalid_argument", name, err)
		}
	}
	if count := env.countRows(t, "SELECT count(*) FROM reader_icon_presets WHERE tenant_id = $1", tenant.Tenant.ID); count != 0 {
		t.Fatalf("presets = %d, want a refused upload to store nothing", count)
	}
}
