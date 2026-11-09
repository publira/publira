package adminapi

import (
	"context"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/auditlog"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// A key with catalog:write creates a series and an episode, gives the episode
// its pages, and schedules it, and every one of those writes is in the audit
// log under the key's name. A key without the scope is refused the same calls,
// and the scope opens nothing beyond the catalog's writes.
func TestDBACatalogWriteKeyPutsAnEpisodeInUnderItsName(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "KEYWRITE01", "keys-write.example.com", "Key Tenant", "KEYWADMIN1", "admin@keys-write.example.com")
	writer := createAPIKey(t, env, admin, publiraadminv1.ApiKeyScope_API_KEY_SCOPE_CATALOG_WRITE)
	reader := createAPIKey(t, env, admin, publiraadminv1.ApiKeyScope_API_KEY_SCOPE_CATALOG_READ)
	withKey := func(key string) context.Context {
		return testutil.WithBearer(context.Background(), key)
	}
	series := env.seriesClient()
	tenant := admin.tenantContext()
	scheduledAt := time.Now().Add(48 * time.Hour).UTC().Truncate(time.Second).Format(time.RFC3339)

	// The same writes with a key that only reads are refused before anything
	// is looked up.
	if _, err := series.CreateSeries(withKey(reader.Key), &publiraadminv1.CreateSeriesRequest{Tenant: tenant, Title: "Refused"}); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("CreateSeries with a catalog:read key = %v, want %v", connect.CodeOf(err), connect.CodePermissionDenied)
	}

	createdSeries, err := series.CreateSeries(withKey(writer.Key), &publiraadminv1.CreateSeriesRequest{
		Tenant:                   tenant,
		Title:                    "Written by the editorial system",
		EyeCatchImageData:        aspectJPEG(t, 2400, 3200),
		EyeCatchImageContentType: "image/jpeg",
	})
	if err != nil {
		t.Fatalf("CreateSeries with a catalog:write key: %v", err)
	}
	if _, err := series.CreateEpisode(withKey(reader.Key), &publiraadminv1.CreateEpisodeRequest{Tenant: tenant, SeriesId: createdSeries.Series.Id, Title: "Refused"}); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("CreateEpisode with a catalog:read key = %v, want %v", connect.CodeOf(err), connect.CodePermissionDenied)
	}
	createdEpisode, err := series.CreateEpisode(withKey(writer.Key), &publiraadminv1.CreateEpisodeRequest{Tenant: tenant, SeriesId: createdSeries.Series.Id, Title: "Episode 1"})
	if err != nil {
		t.Fatalf("CreateEpisode with a catalog:write key: %v", err)
	}
	episodeID := createdEpisode.Episode.Id

	pages := &publiraadminv1.UploadEpisodeImagesRequest{
		Tenant:    tenant,
		EpisodeId: episodeID,
		Images: []*publiraadminv1.EpisodeImageUpload{
			{Filename: "001.png", ContentType: "image/png", Data: oneByOnePNG},
			{Filename: "002.png", ContentType: "image/png", Data: oneByOnePNG},
		},
	}
	if _, err := series.UploadEpisodeImages(withKey(reader.Key), pages); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("UploadEpisodeImages with a catalog:read key = %v, want %v", connect.CodeOf(err), connect.CodePermissionDenied)
	}
	uploaded, err := series.UploadEpisodeImages(withKey(writer.Key), pages)
	if err != nil {
		t.Fatalf("UploadEpisodeImages with a catalog:write key: %v", err)
	}
	if got := len(uploaded.Images); got != 2 {
		t.Fatalf("UploadEpisodeImages answered %d pages, want 2", got)
	}
	for _, image := range uploaded.Images {
		// A media token names an operator, and a key is none.
		if strings.Contains(image.ImageUrl, "?") {
			t.Fatalf("a page answered to a key carries a query: %q", image.ImageUrl)
		}
	}
	keyUpdates := func() int {
		return env.countRows(t, `SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND actor_api_key_id = $2 AND action = 'episode_updated'`, admin.Tenant.ID, writer.ApiKey.Id)
	}
	updatesBeforeReorder := keyUpdates()
	reordered, err := series.ReorderEpisodeImages(withKey(writer.Key), &publiraadminv1.ReorderEpisodeImagesRequest{
		Tenant:    tenant,
		EpisodeId: episodeID,
		ImageIds:  []string{uploaded.Images[1].Id, uploaded.Images[0].Id},
	})
	if err != nil {
		t.Fatalf("ReorderEpisodeImages with a catalog:write key: %v", err)
	}
	if reordered.Images[0].Id != uploaded.Images[1].Id {
		t.Fatalf("first page after the reorder = %s, want %s", reordered.Images[0].Id, uploaded.Images[1].Id)
	}
	// The order is what a reader turns the pages in, so it is recorded too.
	if got := keyUpdates() - updatesBeforeReorder; got != 1 {
		t.Fatalf("episode_updated entries the reorder filed under the key = %d, want 1", got)
	}

	// The rest of what the scope admits, each answered rather than refused.
	// In order: an episode takes its aspect variants only once it has an eye-catch.
	for _, w := range []struct {
		name  string
		write func(context.Context) error
	}{
		{"UpdateSeries", func(ctx context.Context) error {
			_, err := series.UpdateSeries(ctx, &publiraadminv1.UpdateSeriesRequest{Tenant: tenant, SeriesId: createdSeries.Series.Id, Title: "Renamed by the editorial system"})
			return err
		}},
		{"UpdateEpisodeTitle", func(ctx context.Context) error {
			_, err := series.UpdateEpisodeTitle(ctx, &publiraadminv1.UpdateEpisodeTitleRequest{Tenant: tenant, EpisodeId: episodeID, Title: "Episode 1, renamed"})
			return err
		}},
		{"UpdateEpisodePricing", func(ctx context.Context) error {
			_, err := series.UpdateEpisodePricing(ctx, &publiraadminv1.UpdateEpisodePricingRequest{Tenant: tenant, EpisodeId: episodeID})
			return err
		}},
		{"UpdateEpisodeLayout", func(ctx context.Context) error {
			_, err := series.UpdateEpisodeLayout(ctx, &publiraadminv1.UpdateEpisodeLayoutRequest{Tenant: tenant, EpisodeId: episodeID, ReadingDirection: publirattypesv1.ReadingDirection_READING_DIRECTION_RIGHT_TO_LEFT})
			return err
		}},
		{"ReplaceEpisodeCredits", func(ctx context.Context) error {
			_, err := series.ReplaceEpisodeCredits(ctx, &publiraadminv1.ReplaceEpisodeCreditsRequest{Tenant: tenant, EpisodeId: episodeID})
			return err
		}},
		{"UploadSeriesEyeCatchAspectImage", func(ctx context.Context) error {
			_, err := series.UploadSeriesEyeCatchAspectImage(ctx, &publiraadminv1.UploadSeriesEyeCatchAspectImageRequest{Tenant: tenant, SeriesId: createdSeries.Series.Id, VariantType: "landscape", ImageData: aspectJPEG(t, 1600, 900), ImageContentType: "image/jpeg"})
			return err
		}},
		{"UploadEpisodeEyeCatchImage", func(ctx context.Context) error {
			_, err := series.UploadEpisodeEyeCatchImage(ctx, &publiraadminv1.UploadEpisodeEyeCatchImageRequest{Tenant: tenant, EpisodeId: episodeID, ImageData: aspectJPEG(t, 2400, 3200), ImageContentType: "image/jpeg"})
			return err
		}},
		{"UploadEpisodeEyeCatchAspectImage", func(ctx context.Context) error {
			_, err := series.UploadEpisodeEyeCatchAspectImage(ctx, &publiraadminv1.UploadEpisodeEyeCatchAspectImageRequest{Tenant: tenant, EpisodeId: episodeID, VariantType: "landscape", ImageData: aspectJPEG(t, 1600, 900), ImageContentType: "image/jpeg"})
			return err
		}},
		{"ReplaceEpisodeImage", func(ctx context.Context) error {
			_, err := series.ReplaceEpisodeImage(ctx, &publiraadminv1.ReplaceEpisodeImageRequest{Tenant: tenant, EpisodeId: episodeID, ImageId: reordered.Images[1].Id, Filename: "003.png", ContentType: "image/png", Data: oneByOnePNG})
			return err
		}},
	} {
		if code := connect.CodeOf(w.write(withKey(reader.Key))); code != connect.CodePermissionDenied {
			t.Errorf("%s with a catalog:read key = %v, want %v", w.name, code, connect.CodePermissionDenied)
		}
		if err := w.write(withKey(writer.Key)); err != nil {
			t.Errorf("%s with a catalog:write key: %v", w.name, err)
		}
	}
	remaining, err := series.DeleteEpisodeImage(withKey(writer.Key), &publiraadminv1.DeleteEpisodeImageRequest{Tenant: tenant, EpisodeId: episodeID, ImageId: reordered.Images[0].Id})
	if err != nil {
		t.Fatalf("DeleteEpisodeImage with a catalog:write key: %v", err)
	}
	if got := len(remaining.Images); got != 1 {
		t.Fatalf("pages left after the delete = %d, want 1", got)
	}

	schedule := &publiraadminv1.UpdateEpisodePublishScheduleRequest{Tenant: tenant, EpisodeId: episodeID, ScheduledAt: scheduledAt}
	if _, err := series.UpdateEpisodePublishSchedule(withKey(reader.Key), schedule); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("UpdateEpisodePublishSchedule with a catalog:read key = %v, want %v", connect.CodeOf(err), connect.CodePermissionDenied)
	}
	scheduled, err := series.UpdateEpisodePublishSchedule(withKey(writer.Key), schedule)
	if err != nil {
		t.Fatalf("UpdateEpisodePublishSchedule with a catalog:write key: %v", err)
	}
	if scheduled.Episode.Status != "scheduled" || scheduled.Episode.ScheduledAt != scheduledAt {
		t.Fatalf("scheduled episode = %s at %s, want scheduled at %s", scheduled.Episode.Status, scheduled.Episode.ScheduledAt, scheduledAt)
	}

	// The scope is the catalog's writes and nothing else: not its reads, not a
	// review decision, and not the tenant's settings.
	if _, err := series.ListSeries(withKey(writer.Key), &publiraadminv1.ListSeriesRequest{Tenant: tenant}); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("ListSeries with a catalog:write key = %v, want %v", connect.CodeOf(err), connect.CodePermissionDenied)
	}
	if _, err := series.ApproveEpisode(withKey(writer.Key), &publiraadminv1.ApproveEpisodeRequest{Tenant: tenant, EpisodeId: episodeID}); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("ApproveEpisode with a catalog:write key = %v, want %v", connect.CodeOf(err), connect.CodePermissionDenied)
	}
	if _, err := env.tenantSettingsClient().UpdateTenantEpisodeReviewSettings(withKey(writer.Key), &publiraadminv1.UpdateTenantEpisodeReviewSettingsRequest{Tenant: tenant}); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("UpdateTenantEpisodeReviewSettings with a catalog:write key = %v, want %v", connect.CodeOf(err), connect.CodePermissionDenied)
	}
	if _, err := env.apiKeyClient().CreateApiKey(withKey(writer.Key), &publiraadminv1.CreateApiKeyRequest{Tenant: tenant, Name: "Another", Scopes: []publiraadminv1.ApiKeyScope{publiraadminv1.ApiKeyScope_API_KEY_SCOPE_CATALOG_WRITE}}); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("CreateApiKey with a catalog:write key = %v, want %v", connect.CodeOf(err), connect.CodePermissionDenied)
	}

	listed, err := env.auditClient().ListAuditLogs(testutil.WithBearer(context.Background(), admin.token()), &publiraadminv1.ListAuditLogsRequest{Tenant: tenant, Limit: 100})
	if err != nil {
		t.Fatalf("ListAuditLogs: %v", err)
	}
	byKey := map[string]int{}
	for _, entry := range listed.AuditLogs {
		if entry.ActorRole != auditlog.RoleAPIKey {
			continue
		}
		if entry.ActorApiKeyId != writer.ApiKey.Id || entry.ActorApiKeyPrefix != writer.ApiKey.Prefix || entry.ActorName != "Data warehouse" || entry.ActorUserPublicId != "" {
			t.Fatalf("an entry filed under a key = %+v, want the key %s (%s) by its name and no member", entry, writer.ApiKey.Id, writer.ApiKey.Prefix)
		}
		byKey[entry.Action]++
	}
	for action, want := range map[string]int{
		"series_created":         1,
		"episode_created":        1,
		"episode_image_uploaded": 2,
		"episode_updated":        1,
	} {
		if got := byKey[action]; got < want {
			t.Errorf("%s entries filed under the key = %d, want at least %d (all of the key's: %v)", action, got, want, byKey)
		}
	}
	// No write went unrecorded for want of an actor the row accepts.
	if got := env.countRows(t, `SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND actor_role = '' `, admin.Tenant.ID); got != 0 {
		t.Fatalf("entries with no role = %d, want 0", got)
	}
}

// While the tenant requires review, a schedule a key sets submits the episode
// for review as a member's does, in nobody's name, and a Tenant admin's
// approval is what publishes it.
func TestDBACatalogWriteKeysScheduleWaitsForReview(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	f := env.seedEpisodeReviewFixture(t, "KEYREV")
	env.setEpisodeReviewRequired(t, f.admin, true)
	key := createAPIKey(t, env, f.admin, publiraadminv1.ApiKeyScope_API_KEY_SCOPE_CATALOG_WRITE)
	series := env.seriesClient()

	// A time that has passed would publish the episode at once without review.
	scheduled, err := series.UpdateEpisodePublishSchedule(testutil.WithBearer(context.Background(), key.Key), &publiraadminv1.UpdateEpisodePublishScheduleRequest{
		Tenant:      f.admin.tenantContext(),
		EpisodeId:   f.episodeID,
		ScheduledAt: time.Now().Add(-time.Minute).UTC().Truncate(time.Second).Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("UpdateEpisodePublishSchedule with a catalog:write key: %v", err)
	}
	if scheduled.Episode.Status != "scheduled" || reviewState(t, scheduled.Episode) != publirattypesv1.EpisodeReviewState_EPISODE_REVIEW_STATE_IN_REVIEW {
		t.Fatalf("scheduled episode = %s, %v, want scheduled and in review", scheduled.Episode.Status, scheduled.Episode.Review)
	}
	if got := env.countRows(t, `SELECT count(*) FROM episode_reviews WHERE tenant_id = $1 AND submitted_by_user_id IS NULL`, f.admin.Tenant.ID); got != 1 {
		t.Fatalf("rounds submitted in nobody's name = %d, want 1", got)
	}
	if got := env.countRows(t, `SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND actor_api_key_id = $2 AND target_id = $3`, f.admin.Tenant.ID, key.ApiKey.Id, f.publicID); got == 0 {
		t.Fatal("the key's submission is not in the audit log under the key")
	}

	approved, err := series.ApproveEpisode(testutil.WithBearer(context.Background(), f.admin.token()), &publiraadminv1.ApproveEpisodeRequest{
		Tenant: f.admin.tenantContext(), EpisodeId: f.episodeID,
	})
	if err != nil {
		t.Fatalf("ApproveEpisode: %v", err)
	}
	if approved.Episode.Status != "published" {
		t.Fatalf("approved episode = %s, want published", approved.Episode.Status)
	}
}
