package publicapi

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"image"
	"image/png"
	"log/slog"
	"slices"
	"strings"
	"sync"
	"testing"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/platformpolicy"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/revalidate"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/storage"
	"github.com/publira/publira/server/internal/testutil"
)

// iconStore keeps every object an icon upload stores.
type iconStore struct {
	mu   sync.Mutex
	keys []string
}

func (s *iconStore) Upload(_ context.Context, req storage.UploadRequest) (storage.UploadResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.keys = append(s.keys, req.ObjectKey)
	return storage.UploadResult{Provider: "s3", ObjectKey: req.ObjectKey, SizeBytes: int64(len(req.Data))}, nil
}

func (s *iconStore) objectKeys() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return slices.Clone(s.keys)
}

// newIconDBEnv is a public API server whose reader icons go to store, and
// whose cache invalidations are recorded for the outbox worker to send.
func newIconDBEnv(t *testing.T, guards readerGuards, store storage.Provider) *publicDBEnv {
	t.Helper()

	// The client only has to exist for the requester to record: with no pool
	// to mark a send done on, the requester leaves every send to the worker.
	t.Setenv("PUBLIRA_WEB_STOREFRONT_INTERNAL_URL", "http://127.0.0.1:1")
	client, err := revalidate.NewClient("test-revalidate-token", slog.Default())
	if err != nil {
		t.Fatalf("revalidate.NewClient: %v", err)
	}
	return newPublicDBEnvConfigured(t, guards, openMailGuard(), func(api *apiServer, db *sql.DB) {
		api.storage = store
		api.reval = revalidate.NewRequester(revalidate.RequesterConfig{
			Client:  client,
			Queries: dbmodels.New(db),
		})
	})
}

func iconPNG(t *testing.T, width, height int) []byte {
	t.Helper()

	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, width, height))); err != nil {
		t.Fatalf("png.Encode: %v", err)
	}
	return buf.Bytes()
}

func (e *publicDBEnv) uploadMyIcon(t *testing.T, tenant testutil.Tenant, reader testutil.TenantUser, req *publirav1.UploadMyIconRequest) (*publirattypesv1.User, error) {
	t.Helper()

	req.Tenant = tenantContext(tenant)
	res, err := e.authClient().UploadMyIcon(testutil.WithBearer(context.Background(), tokenFor(t, tenant, reader)), req)
	if err != nil {
		return nil, err
	}
	return res.User, nil
}

func (e *publicDBEnv) mustUploadMyIcon(t *testing.T, tenant testutil.Tenant, reader testutil.TenantUser) *publirattypesv1.User {
	t.Helper()

	user, err := e.uploadMyIcon(t, tenant, reader, &publirav1.UploadMyIconRequest{IconData: iconPNG(t, 300, 200), IconContentType: "image/png"})
	if err != nil {
		t.Fatalf("UploadMyIcon: %v", err)
	}
	return user
}

func (e *publicDBEnv) deleteMyIcon(t *testing.T, tenant testutil.Tenant, reader testutil.TenantUser) *publirattypesv1.User {
	t.Helper()

	res, err := e.authClient().DeleteMyIcon(testutil.WithBearer(context.Background(), tokenFor(t, tenant, reader)), &publirav1.DeleteMyIconRequest{Tenant: tenantContext(tenant)})
	if err != nil {
		t.Fatalf("DeleteMyIcon: %v", err)
	}
	return res.User
}

func (e *publicDBEnv) getMe(t *testing.T, tenant testutil.Tenant, reader testutil.TenantUser) *publirattypesv1.User {
	t.Helper()

	res, err := e.authClient().GetMe(testutil.WithBearer(context.Background(), tokenFor(t, tenant, reader)), &publirav1.GetMeRequest{Tenant: tenantContext(tenant)})
	if err != nil {
		t.Fatalf("GetMe: %v", err)
	}
	return res.User
}

// iconURL is the one URL an account's icon answers on, and empty for an
// account that shows none.
func iconURL(t *testing.T, variants []*publirattypesv1.UserIconVariant) string {
	t.Helper()

	switch len(variants) {
	case 0:
		return ""
	case 1:
		return variants[0].Url
	}
	t.Fatalf("icon variants = %v, want the one variant an icon is stored as", variants)
	return ""
}

func TestDBUploadMyIconSetsReplacesAndRemovesTheReadersIcon(t *testing.T) {
	store := &iconStore{}
	env := newIconDBEnv(t, openReaderGuards(), store)
	tenant := env.seedTenant(t, "ICONTENANT", "icon.example.com", "Icon Tenant")
	reader := env.PG.SeedEndUser(t, tenant.ID, "ICONREADER", "icon-reader@example.com", "Icon Reader")

	if me := env.getMe(t, tenant, reader); len(me.IconImageVariants) != 0 || me.IconImageUpdatedAt != "" {
		t.Fatalf("GetMe before any upload = %v at %q, want no icon", me.IconImageVariants, me.IconImageUpdatedAt)
	}

	uploaded := env.mustUploadMyIcon(t, tenant, reader)
	if uploaded.PublicId != reader.PublicID {
		t.Fatalf("UploadMyIcon answered %s, want the caller %s", uploaded.PublicId, reader.PublicID)
	}
	first := iconURL(t, uploaded.IconImageVariants)
	if !strings.HasPrefix(first, "/images/users/") {
		t.Fatalf("icon URL = %q, want an image-server user icon URL", first)
	}
	if variant := uploaded.IconImageVariants[0]; variant.Width != 200 || variant.Height != 200 || variant.ContentType != "image/png" || variant.FileSizeBytes <= 0 {
		t.Fatalf("icon variant = %v, want the 200 px PNG square cut from the centre of the upload", variant)
	}
	if uploaded.IconImageUpdatedAt == "" {
		t.Fatalf("UploadMyIcon icon_image_updated_at is empty, want the time the icon was stored")
	}
	if me := env.getMe(t, tenant, reader); iconURL(t, me.IconImageVariants) != first || me.IconImageUpdatedAt != uploaded.IconImageUpdatedAt {
		t.Fatalf("GetMe after the upload = %v at %q, want %s at %q", me.IconImageVariants, me.IconImageUpdatedAt, first, uploaded.IconImageUpdatedAt)
	}
	keys := store.objectKeys()
	if len(keys) != 1 || !strings.HasPrefix(keys[0], "tenants/ICONTENANT/users/ICONREADER/") {
		t.Fatalf("stored objects = %v, want the one icon under the reader's prefix", keys)
	}

	// A replacement is a new image under a new URL, so a page holding the old
	// one cannot keep showing it.
	replaced := env.mustUploadMyIcon(t, tenant, reader)
	second := iconURL(t, replaced.IconImageVariants)
	if second == "" || second == first {
		t.Fatalf("icon URL after a replacement = %q, want a new one in place of %q", second, first)
	}
	if me := env.getMe(t, tenant, reader); iconURL(t, me.IconImageVariants) != second {
		t.Fatalf("GetMe after the replacement = %v, want %s", me.IconImageVariants, second)
	}
	// A page that read the account before the replacement and asks for its
	// icon afterwards is answered the replacement, never the image
	// image-server now refuses.
	rows, err := dbmodels.New(env.PG.DB).ListUserIconVariantsByUserIDs(context.Background(), dbmodels.ListUserIconVariantsByUserIDsParams{
		TenantID: tenant.ID,
		UserIds:  []uuid.UUID{reader.ID},
	})
	if err != nil {
		t.Fatalf("ListUserIconVariantsByUserIDs: %v", err)
	}
	if len(rows) != 1 || "/images/users/"+rows[0].IconID.String() != second {
		t.Fatalf("icon variants read after the replacement = %v, want the one variant of %s", rows, second)
	}

	if removed := env.deleteMyIcon(t, tenant, reader); len(removed.IconImageVariants) != 0 || removed.IconImageUpdatedAt != "" {
		t.Fatalf("DeleteMyIcon = %v at %q, want no icon", removed.IconImageVariants, removed.IconImageUpdatedAt)
	}
	if me := env.getMe(t, tenant, reader); len(me.IconImageVariants) != 0 {
		t.Fatalf("GetMe after the removal = %v, want no icon", me.IconImageVariants)
	}
	// Removing an icon the account no longer shows answers the account as it is.
	if removed := env.deleteMyIcon(t, tenant, reader); len(removed.IconImageVariants) != 0 {
		t.Fatalf("DeleteMyIcon with no icon = %v, want no icon", removed.IconImageVariants)
	}
}

func TestDBMyIconRefusesACallerWithNoSession(t *testing.T) {
	env := newIconDBEnv(t, openReaderGuards(), &iconStore{})
	tenant := env.seedTenant(t, "ICONANON", "icon-anon.example.com", "Icon Tenant")

	_, err := env.authClient().UploadMyIcon(context.Background(), &publirav1.UploadMyIconRequest{
		Tenant:          tenantContext(tenant),
		IconData:        iconPNG(t, 200, 200),
		IconContentType: "image/png",
	})
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("UploadMyIcon with no session = %v, want unauthenticated", err)
	}
	_, err = env.authClient().DeleteMyIcon(context.Background(), &publirav1.DeleteMyIconRequest{Tenant: tenantContext(tenant)})
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("DeleteMyIcon with no session = %v, want unauthenticated", err)
	}
	if got := env.countRows(t, "SELECT COUNT(*) FROM user_images WHERE tenant_id = $1", tenant.ID); got != 0 {
		t.Fatalf("user_images = %d rows, want a refused upload to store nothing", got)
	}
}

// The session names the account an icon RPC acts on, and nothing in the
// request names another, so one reader's upload or removal leaves every other
// reader's icon as it was.
func TestDBMyIconLeavesEveryOtherReadersIconAlone(t *testing.T) {
	env := newIconDBEnv(t, openReaderGuards(), &iconStore{})
	tenant := env.seedTenant(t, "ICONPAIR", "icon-pair.example.com", "Icon Tenant")
	owner := env.PG.SeedEndUser(t, tenant.ID, "ICONOWNER", "icon-owner@example.com", "Icon Owner")
	other := env.PG.SeedEndUser(t, tenant.ID, "ICONOTHER", "icon-other@example.com", "Icon Other")

	ownersIcon := iconURL(t, env.mustUploadMyIcon(t, tenant, owner).IconImageVariants)

	env.mustUploadMyIcon(t, tenant, other)
	env.deleteMyIcon(t, tenant, other)

	if me := env.getMe(t, tenant, owner); iconURL(t, me.IconImageVariants) != ownersIcon {
		t.Fatalf("owner's icon after another reader's changes = %v, want %s", me.IconImageVariants, ownersIcon)
	}
	if me := env.getMe(t, tenant, other); len(me.IconImageVariants) != 0 {
		t.Fatalf("other reader's icon = %v, want none after their removal", me.IconImageVariants)
	}
}

// A password sign-in answers with the account as GetMe reads it, icon
// included, so a client that keeps the icon in its session has it from the
// sign-in on rather than from the next GetMe.
func TestDBLoginAnswersWithTheReadersIcon(t *testing.T) {
	env := newIconDBEnv(t, openReaderGuards(), &iconStore{})
	tenant := env.seedTenant(t, "ICONLOGIN", "icon-login.example.com", "Icon Tenant")
	withIcon := env.PG.SeedEndUser(t, tenant.ID, "ICONSIGNIN", "icon-login-with@example.com", "Icon Reader")
	withoutIcon := env.PG.SeedEndUser(t, tenant.ID, "PLAINSIGNIN", "icon-login-none@example.com", "Plain Reader")

	uploaded := env.mustUploadMyIcon(t, tenant, withIcon)

	signedIn, err := loginReader(env.authClient(), tenant, withIcon.Email)
	if err != nil {
		t.Fatalf("Login with an icon: %v", err)
	}
	if got := signedIn.User; iconURL(t, got.IconImageVariants) != iconURL(t, uploaded.IconImageVariants) || got.IconImageUpdatedAt != uploaded.IconImageUpdatedAt {
		t.Fatalf("Login with an icon = %v at %q, want %v at %q", got.IconImageVariants, got.IconImageUpdatedAt, uploaded.IconImageVariants, uploaded.IconImageUpdatedAt)
	}

	signedIn, err = loginReader(env.authClient(), tenant, withoutIcon.Email)
	if err != nil {
		t.Fatalf("Login without an icon: %v", err)
	}
	if got := signedIn.User; len(got.IconImageVariants) != 0 || got.IconImageUpdatedAt != "" {
		t.Fatalf("Login without an icon = %v at %q, want no icon", got.IconImageVariants, got.IconImageUpdatedAt)
	}
}

func TestDBUploadMyIconRefusesAnUploadItCannotStore(t *testing.T) {
	env := newIconDBEnv(t, openReaderGuards(), &iconStore{})
	tenant := env.seedTenant(t, "ICONBAD", "icon-bad.example.com", "Icon Tenant")
	reader := env.PG.SeedEndUser(t, tenant.ID, "ICONBADUSER", "icon-bad@example.com", "Icon Reader")

	cases := []struct {
		name  string
		req   *publirav1.UploadMyIconRequest
		field string
	}{
		{"not an image", &publirav1.UploadMyIconRequest{IconData: []byte("plain text"), IconContentType: "text/plain"}, "icon_data"},
		{"smaller than an icon", &publirav1.UploadMyIconRequest{IconData: iconPNG(t, 64, 64), IconContentType: "image/png"}, "icon_data"},
		{"empty", &publirav1.UploadMyIconRequest{}, "icon_data"},
		{"crop outside the upload", &publirav1.UploadMyIconRequest{
			IconData:        iconPNG(t, 300, 300),
			IconContentType: "image/png",
			IconCrop:        &publirattypesv1.ImageCropRect{X: 200, Y: 200, Width: 200, Height: 200},
		}, "icon_crop"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := env.uploadMyIcon(t, tenant, reader, tc.req)
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("UploadMyIcon = %v, want invalid_argument", err)
			}
			assertPublicBadRequestField(t, err, tc.field)
		})
	}
	if got := env.countRows(t, "SELECT COUNT(*) FROM user_images WHERE tenant_id = $1", tenant.ID); got != 0 {
		t.Fatalf("user_images = %d rows, want a refused upload to store nothing", got)
	}
}

func TestDBUploadMyIconRefusesWhileThePlatformHasNoObjectStore(t *testing.T) {
	env := newIconDBEnv(t, openReaderGuards(), nil)
	tenant := env.seedTenant(t, "ICONNOST", "icon-nostore.example.com", "Icon Tenant")
	reader := env.PG.SeedEndUser(t, tenant.ID, "ICONNOSTUSER", "icon-nostore@example.com", "Icon Reader")

	_, err := env.uploadMyIcon(t, tenant, reader, &publirav1.UploadMyIconRequest{IconData: iconPNG(t, 200, 200), IconContentType: "image/png"})
	if reason, _ := errorInfoReason(err); connect.CodeOf(err) != connect.CodeFailedPrecondition || reason != rpcerrors.ReasonStorageNotConfigured {
		t.Fatalf("UploadMyIcon with no object store = %v (reason %q), want failed_precondition %s", err, reason, rpcerrors.ReasonStorageNotConfigured)
	}
}

// An upload and a removal spend the same allowance, so alternating the two is
// no way around it.
func TestDBMyIconChargesTheIconChangeLimit(t *testing.T) {
	guards := guardsWith(func(policy *platformpolicy.Policy) {
		policy.IconChange = platformpolicy.MinuteDay{PerMinute: 2, PerDay: 2}
	})
	env := newIconDBEnv(t, guards, &iconStore{})
	tenant := env.seedTenant(t, "ICONLIMIT", "icon-limit.example.com", "Icon Tenant")
	reader := env.PG.SeedEndUser(t, tenant.ID, "ICONLIMUSER", "icon-limit@example.com", "Icon Reader")

	env.mustUploadMyIcon(t, tenant, reader)
	env.deleteMyIcon(t, tenant, reader)
	_, err := env.uploadMyIcon(t, tenant, reader, &publirav1.UploadMyIconRequest{IconData: iconPNG(t, 200, 200), IconContentType: "image/png"})
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("UploadMyIcon past the allowance = %v, want resource_exhausted", err)
	}
	if me := env.getMe(t, tenant, reader); len(me.IconImageVariants) != 0 {
		t.Fatalf("icon after a refused upload = %v, want none", me.IconImageVariants)
	}
}

func TestDBListEpisodeCommentsCarriesTheAuthorsIcon(t *testing.T) {
	env := newIconDBEnv(t, openReaderGuards(), &iconStore{})
	tenant := env.seedTenant(t, "ICONCMT", "icon-comment.example.com", "Icon Tenant")
	withIcon := env.PG.SeedEndUser(t, tenant.ID, "ICONCMTWITH", "icon-with@example.com", "Reader With Icon")
	withoutIcon := env.PG.SeedEndUser(t, tenant.ID, "ICONCMTNONE", "icon-without@example.com", "Reader Without Icon")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "ICONCMTSER", Title: "Commented series", Published: true})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "ICONCMTEP",
		Title:    "Commented episode",
		Status:   testutil.EpisodeStatusPublished,
	})
	env.setCommentMode(t, tenant.ID, "immediate")

	icon := iconURL(t, env.mustUploadMyIcon(t, tenant, withIcon).IconImageVariants)
	byIcon := env.mustPostComment(t, tenant, withIcon, episode.ID.String(), "Posted by a reader with an icon.")
	byIconAgain := env.mustPostComment(t, tenant, withIcon, episode.ID.String(), "Posted again by the same reader.")
	byNoIcon := env.mustPostComment(t, tenant, withoutIcon, episode.ID.String(), "Posted by a reader with no icon.")

	comments := env.listComments(t, tenant, episode.ID.String(), 0, "").Comments
	if got := commentPublicIDs(comments); len(got) != 3 {
		t.Fatalf("public comments = %v, want all three", got)
	}
	for _, comment := range comments {
		want := ""
		if comment.PublicId == byIcon.PublicId || comment.PublicId == byIconAgain.PublicId {
			want = icon
		}
		if got := iconURL(t, comment.AuthorIconImageVariants); got != want {
			t.Fatalf("comment %s author icon = %q, want %q", comment.PublicId, got, want)
		}
	}
	if !containsPublicID(commentPublicIDs(comments), byNoIcon.PublicId) {
		t.Fatalf("public comments = %v, want the comment by the reader with no icon listed", commentPublicIDs(comments))
	}

	// The list a storefront has cached carries the icon's URL, which stops
	// answering once the icon is replaced, so the change owes its drop.
	env.deleteMyIcon(t, tenant, withIcon)
	want := commentListRevalidateTags(tenant.ID, episode.PublicID)[0]
	if tags := env.revalidatedTags(t, tenant); !slices.Contains(tags, want) {
		t.Fatalf("recorded cache invalidations = %v, want %s", tags, want)
	}
	for _, comment := range env.listComments(t, tenant, episode.ID.String(), 0, "").Comments {
		if len(comment.AuthorIconImageVariants) != 0 {
			t.Fatalf("comment %s author icon after the removal = %v, want none", comment.PublicId, comment.AuthorIconImageVariants)
		}
	}
}

// revalidatedTags is every cache tag the tenant's writes have recorded an
// invalidation of.
func (e *publicDBEnv) revalidatedTags(t *testing.T, tenant testutil.Tenant) []string {
	t.Helper()

	rows, err := e.PG.DB.QueryContext(context.Background(),
		`SELECT payload FROM outbox_events WHERE tenant_id = $1 AND event_type = $2`,
		tenant.ID, outbox.EventTypeNextCacheRevalidation,
	)
	if err != nil {
		t.Fatalf("list cache invalidations: %v", err)
	}
	defer rows.Close() //nolint:errcheck

	var tags []string
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			t.Fatalf("scan cache invalidation: %v", err)
		}
		var payload outbox.NextCacheRevalidationPayload
		if err := json.Unmarshal(raw, &payload); err != nil {
			t.Fatalf("decode cache invalidation: %v", err)
		}
		tags = append(tags, payload.Tags...)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("list cache invalidations: %v", err)
	}
	return tags
}
