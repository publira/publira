package publicapi

import (
	"context"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/testutil"
	"github.com/publira/publira/server/internal/usericon"
)

// setReaderIconPolicy writes the tenant's reader icon policy directly, without
// the clear the admin API's save makes, so a test can hold an icon the policy
// no longer allows.
func (e *publicDBEnv) setReaderIconPolicy(t *testing.T, tenantID uuid.UUID, policy string) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := e.PG.DB.ExecContext(ctx, `
		INSERT INTO tenant_config (tenant_id, reader_icon_policy)
		VALUES ($1, $2)
		ON CONFLICT (tenant_id) DO UPDATE SET reader_icon_policy = EXCLUDED.reader_icon_policy
	`, tenantID, policy); err != nil {
		t.Fatalf("set reader_icon_policy = %s: %v", policy, err)
	}
}

// seedReaderIconPreset stores a preset the way the admin API's upload does,
// and answers its id.
func (e *publicDBEnv) seedReaderIconPreset(t *testing.T, tenant testutil.Tenant) string {
	t.Helper()

	presetID, err := usericon.StorePreset(context.Background(), dbmodels.New(e.PG.DB), &iconStore{}, tenant.ID, tenant.PublicID, usericon.Upload{
		Data:        iconPNG(t, 200, 200),
		ContentType: "image/png",
	})
	if err != nil {
		t.Fatalf("usericon.StorePreset: %v", err)
	}
	return presetID.String()
}

func (e *publicDBEnv) selectMyIcon(t *testing.T, tenant testutil.Tenant, reader testutil.TenantUser, presetID string) (*publirattypesv1.User, error) {
	t.Helper()

	res, err := e.authClient().SelectMyIcon(testutil.WithBearer(context.Background(), tokenFor(t, tenant, reader)), &publirav1.SelectMyIconRequest{
		Tenant:   tenantContext(tenant),
		PresetId: presetID,
	})
	if err != nil {
		return nil, err
	}
	return res.User, nil
}

func (e *publicDBEnv) readerIconPolicy(t *testing.T, tenant testutil.Tenant) *publirav1.GetTenantReaderIconPolicyResponse {
	t.Helper()

	res, err := e.tenantAPIClient().GetTenantReaderIconPolicy(context.Background(), &publirav1.GetTenantReaderIconPolicyRequest{Tenant: tenantContext(tenant)})
	if err != nil {
		t.Fatalf("GetTenantReaderIconPolicy: %v", err)
	}
	return res
}

func requireReaderIconNotAllowed(t *testing.T, rpc string, err error) {
	t.Helper()

	if reason, _ := errorInfoReason(err); connect.CodeOf(err) != connect.CodeFailedPrecondition || reason != rpcerrors.ReasonReaderIconNotAllowed {
		t.Fatalf("%s = %v (reason %q), want failed_precondition %s", rpc, err, reason, rpcerrors.ReasonReaderIconNotAllowed)
	}
}

// Under each policy the public API accepts exactly the icon operations the
// policy allows, and GetTenantReaderIconPolicy says which: an upload under
// upload, a preset under preset, neither under disabled, and a removal under
// all three.
func TestDBEachReaderIconPolicyAcceptsExactlyItsIconOperations(t *testing.T) {
	env := newIconDBEnv(t, openReaderGuards(), &iconStore{})

	for _, tc := range []struct {
		stored        string
		policy        publirattypesv1.ReaderIconPolicy
		upload        bool
		selectPreset  bool
		listedPresets int
	}{
		{usericon.PolicyUpload, publirattypesv1.ReaderIconPolicy_READER_ICON_POLICY_UPLOAD, true, false, 0},
		{usericon.PolicyPreset, publirattypesv1.ReaderIconPolicy_READER_ICON_POLICY_PRESET, false, true, 1},
		{usericon.PolicyDisabled, publirattypesv1.ReaderIconPolicy_READER_ICON_POLICY_DISABLED, false, false, 0},
	} {
		t.Run(tc.stored, func(t *testing.T) {
			prefix := "RIP" + strings.ToUpper(tc.stored[:3])
			tenant := env.seedTenant(t, prefix+"TENANT", tc.stored+".reader-icon-policy.example.com", "Icon Policy")
			reader := env.PG.SeedEndUser(t, tenant.ID, prefix+"READER", "reader@"+tc.stored+".reader-icon-policy.example.com", "Icon Reader")
			presetID := env.seedReaderIconPreset(t, tenant)
			env.setReaderIconPolicy(t, tenant.ID, tc.stored)

			answered := env.readerIconPolicy(t, tenant)
			if answered.Policy != tc.policy || len(answered.Presets) != tc.listedPresets {
				t.Fatalf("GetTenantReaderIconPolicy = %s with %d presets, want %s with %d", answered.Policy, len(answered.Presets), tc.policy, tc.listedPresets)
			}

			uploaded, err := env.uploadMyIcon(t, tenant, reader, &publirav1.UploadMyIconRequest{IconData: iconPNG(t, 200, 200), IconContentType: "image/png"})
			if tc.upload {
				if err != nil || !strings.HasPrefix(iconURL(t, uploaded.IconImageVariants), "/images/users/") {
					t.Fatalf("UploadMyIcon = %v, %v, want the uploaded icon", uploaded, err)
				}
			} else {
				requireReaderIconNotAllowed(t, "UploadMyIcon", err)
			}

			selected, err := env.selectMyIcon(t, tenant, reader, presetID)
			if tc.selectPreset {
				if err != nil || selected.IconPresetId != presetID || iconURL(t, selected.IconImageVariants) != "/images/reader-icon-presets/"+presetID {
					t.Fatalf("SelectMyIcon = %v, %v, want the preset %s", selected, err, presetID)
				}
			} else {
				requireReaderIconNotAllowed(t, "SelectMyIcon", err)
			}

			if removed := env.deleteMyIcon(t, tenant, reader); len(removed.IconImageVariants) != 0 || removed.IconPresetId != "" {
				t.Fatalf("DeleteMyIcon = %v (preset %q), want no icon", removed.IconImageVariants, removed.IconPresetId)
			}
		})
	}
}

// A reader who picks a preset shows it wherever their account is named, in
// place of an upload they showed; a preset the tenant does not hold is not
// found; and once the preset is deleted the reader is left with the fallback.
func TestDBSelectMyIconShowsThePresetUntilItIsDeleted(t *testing.T) {
	env := newIconDBEnv(t, openReaderGuards(), &iconStore{})
	tenant := env.seedTenant(t, "RISTENANT", "reader-icon-select.example.com", "Icon Select")
	other := env.seedTenant(t, "RISOTHER", "reader-icon-select-other.example.com", "Other")
	reader := env.PG.SeedEndUser(t, tenant.ID, "RISREADER", "reader@reader-icon-select.example.com", "Icon Reader")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "RISSERIES", Title: "Commented series", Published: true})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "RISEPISODE",
		Title:    "Commented episode",
		Status:   testutil.EpisodeStatusPublished,
	})
	env.setCommentMode(t, tenant.ID, "immediate")
	presetID := env.seedReaderIconPreset(t, tenant)
	othersPresetID := env.seedReaderIconPreset(t, other)

	// The upload is made under the upload policy, and the preset replaces it.
	env.mustUploadMyIcon(t, tenant, reader)
	env.setReaderIconPolicy(t, tenant.ID, usericon.PolicyPreset)
	presetURL := "/images/reader-icon-presets/" + presetID

	for _, unknown := range []string{othersPresetID, uuid.Must(uuid.NewV7()).String()} {
		if _, err := env.selectMyIcon(t, tenant, reader, unknown); connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("SelectMyIcon %s = %v, want not_found", unknown, err)
		}
	}
	if _, err := env.selectMyIcon(t, tenant, reader, "not-a-uuid"); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("SelectMyIcon with a malformed id = %v, want invalid_argument", err)
	}

	selected, err := env.selectMyIcon(t, tenant, reader, presetID)
	if err != nil {
		t.Fatalf("SelectMyIcon: %v", err)
	}
	if iconURL(t, selected.IconImageVariants) != presetURL || selected.IconPresetId != presetID || selected.IconImageUpdatedAt == "" {
		t.Fatalf("SelectMyIcon = %v (preset %q at %q), want %s", selected.IconImageVariants, selected.IconPresetId, selected.IconImageUpdatedAt, presetURL)
	}
	if me := env.getMe(t, tenant, reader); iconURL(t, me.IconImageVariants) != presetURL || me.IconPresetId != presetID {
		t.Fatalf("GetMe after the selection = %v (preset %q), want %s", me.IconImageVariants, me.IconPresetId, presetURL)
	}
	if count := env.countRows(t, "SELECT COUNT(*) FROM users WHERE id = $1 AND icon_image_id IS NULL", reader.ID); count != 1 {
		t.Fatal("the account still elects its upload beside the preset")
	}
	env.mustPostComment(t, tenant, reader, episode.ID.String(), "Posted with a preset icon.")
	comments := env.listComments(t, tenant, episode.ID.String(), 0, "").Comments
	if len(comments) != 1 || iconURL(t, comments[0].AuthorIconImageVariants) != presetURL {
		t.Fatalf("public comments = %v, want the one comment with the preset %s", comments, presetURL)
	}

	if _, err := env.PG.DB.ExecContext(context.Background(), "DELETE FROM reader_icon_presets WHERE id = $1", uuid.MustParse(presetID)); err != nil {
		t.Fatalf("delete the preset: %v", err)
	}
	if me := env.getMe(t, tenant, reader); len(me.IconImageVariants) != 0 || me.IconPresetId != "" {
		t.Fatalf("GetMe after the preset was deleted = %v (preset %q), want no icon", me.IconImageVariants, me.IconPresetId)
	}
	if comments := env.listComments(t, tenant, episode.ID.String(), 0, "").Comments; len(comments) != 1 || len(comments[0].AuthorIconImageVariants) != 0 {
		t.Fatalf("public comments after the preset was deleted = %v, want no author icon", comments)
	}
}
