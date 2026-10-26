package adminapi

import (
	"context"
	"encoding/json"
	"log/slog"
	"slices"
	"testing"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/revalidate"
	"github.com/publira/publira/server/internal/testutil"
	"github.com/publira/publira/server/internal/usericon"
)

// newReaderIconDBEnv is an admin API server whose cache invalidations are
// recorded for the outbox worker to send, so a test reads back which storefront
// lists a reader action left owing a drop.
func newReaderIconDBEnv(t *testing.T) *adminDBEnv {
	t.Helper()

	// The client only has to exist for the requester to record: with no pool
	// to mark a send done on, the requester leaves every send to the worker.
	t.Setenv("PUBLIRA_WEB_STOREFRONT_INTERNAL_URL", "http://127.0.0.1:1")
	client, err := revalidate.NewClient("test-revalidate-token", slog.Default())
	if err != nil {
		t.Fatalf("revalidate.NewClient: %v", err)
	}
	return newAdminDBEnvWith(t, &testStorageProvider{}, openMailGuard(), nil, nil, func(server *adminServer) {
		server.reval = revalidate.NewRequester(revalidate.RequesterConfig{
			Client:  client,
			Queries: dbmodels.New(server.db),
		})
	})
}

// seedReaderIcon stores an icon for the account the way the reader's own
// upload does, and answers the URL it is served at.
func (e *adminDBEnv) seedReaderIcon(t *testing.T, tenant testutil.Tenant, reader testutil.TenantUser) string {
	t.Helper()

	imageID, err := usericon.Set(context.Background(), dbmodels.New(e.PG.DB), &testStorageProvider{}, usericon.Account{
		TenantID:       tenant.ID,
		TenantPublicID: tenant.PublicID,
		UserID:         reader.ID,
		UserPublicID:   reader.PublicID,
	}, usericon.Upload{Data: brandingSourcePNG(t, 300, 300), ContentType: "image/png"})
	if err != nil {
		t.Fatalf("usericon.Set: %v", err)
	}
	return "/images/users/" + imageID.String()
}

// readerIconURL is the one URL an account's icon answers on, and empty for an
// account that shows none.
func readerIconURL(t *testing.T, variants []*publirattypesv1.UserIconVariant) string {
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

// revalidatedTags is every cache tag the tenant's writes have recorded an
// invalidation of.
func (e *adminDBEnv) revalidatedTags(t *testing.T, tenant testutil.Tenant) []string {
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

func (e *adminDBEnv) removeReaderIcon(t *testing.T, tenant adminDBTenant, readerID uuid.UUID) *publiraadminv1.AdminReader {
	t.Helper()

	res, err := e.userClient().RemoveReaderIcon(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.RemoveReaderIconRequest{
		Tenant:   tenant.tenantContext(),
		ReaderId: readerID.String(),
	})
	if err != nil {
		t.Fatalf("RemoveReaderIcon %s: %v", readerID, err)
	}
	return res.Reader
}

func (e *adminDBEnv) getReader(t *testing.T, tenant adminDBTenant, publicID string) *publiraadminv1.AdminReader {
	t.Helper()

	res, err := e.userClient().GetReader(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.GetReaderRequest{
		Tenant:   tenant.tenantContext(),
		PublicId: publicID,
	})
	if err != nil {
		t.Fatalf("GetReader %s: %v", publicID, err)
	}
	return res.Reader
}

// Every answer that names a reader carries the icon the account shows, and
// nothing for an account that shows none: the reader list and the single
// read, the moderation list, a moderation action, and the report queue.
func TestDBAdminReadersAndCommentsCarryTheReaderIcon(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	fixture := newCommentModerationFixture(t, env, "RIC", "reader-icon.example.com")
	reader := testutil.TenantUser{ID: fixture.reader, PublicID: fixture.readerPublicID}
	plain := env.PG.SeedEndUser(t, fixture.admin.Tenant.ID, "RICPLAIN001", "plain@reader-icon.example.com", "Plain")
	url := env.seedReaderIcon(t, fixture.admin.Tenant, reader)

	iconComment := fixture.seedComment(t, "RICCOMMENT1", "published")
	fixture.seedCommentBy(t, plain.ID, fixture.episode.ID, "RICCOMMENT2", "published")

	readers := env.listReaders(t, fixture.admin, &publiraadminv1.ListReadersRequest{})
	for _, listed := range readers.Readers {
		want := ""
		if listed.PublicId == reader.PublicID {
			want = url
		}
		if got := readerIconURL(t, listed.IconImageVariants); got != want {
			t.Fatalf("listed reader %s icon = %q, want %q", listed.PublicId, got, want)
		}
	}
	if got := readerIconURL(t, env.getReader(t, fixture.admin, reader.PublicID).IconImageVariants); got != url {
		t.Fatalf("GetReader icon = %q, want %q", got, url)
	}
	if got := readerIconURL(t, env.getReader(t, fixture.admin, plain.PublicID).IconImageVariants); got != "" {
		t.Fatalf("GetReader icon of an account with none = %q, want empty", got)
	}

	comments := fixture.list(t, &publiraadminv1.ListCommentsRequest{})
	if len(comments.Comments) != 2 {
		t.Fatalf("listed comments = %d, want 2", len(comments.Comments))
	}
	for _, comment := range comments.Comments {
		want := ""
		if comment.AuthorPublicId == reader.PublicID {
			want = url
		}
		if got := readerIconURL(t, comment.AuthorIconImageVariants); got != want {
			t.Fatalf("comment %s author icon = %q, want %q", comment.PublicId, got, want)
		}
	}

	fixture.seedReport(t, iconComment.ID, fixture.seedReporter(t, "RICREPORTER", "reporter@reader-icon.example.com", "Reporter"), "spam", "")
	reports := fixture.listReports(t, &publiraadminv1.ListCommentReportsRequest{})
	if len(reports.Reports) != 1 || readerIconURL(t, reports.Reports[0].Comment.AuthorIconImageVariants) != url {
		t.Fatalf("report queue = %+v, want the reported comment with its author's icon %s", reports.Reports, url)
	}

	hidden, err := env.commentClient().HideComment(testutil.WithBearer(context.Background(), fixture.admin.token()), &publiraadminv1.HideCommentRequest{
		Tenant:    fixture.admin.tenantContext(),
		CommentId: iconComment.ID.String(),
	})
	if err != nil {
		t.Fatalf("HideComment: %v", err)
	}
	if got := readerIconURL(t, hidden.Comment.AuthorIconImageVariants); got != url {
		t.Fatalf("HideComment author icon = %q, want %q", got, url)
	}
}

func TestDBAdminRemoveReaderIconLeavesTheReaderWithNone(t *testing.T) {
	env := newReaderIconDBEnv(t)
	fixture := newCommentModerationFixture(t, env, "RIR", "reader-icon-remove.example.com")
	reader := testutil.TenantUser{ID: fixture.reader, PublicID: fixture.readerPublicID}
	fixture.seedComment(t, "RIRCOMMENT1", "published")
	env.seedReaderIcon(t, fixture.admin.Tenant, reader)

	removed := env.removeReaderIcon(t, fixture.admin, reader.ID)
	if removed.PublicId != reader.PublicID || len(removed.IconImageVariants) != 0 {
		t.Fatalf("RemoveReaderIcon = %s with %v, want %s with no icon", removed.PublicId, removed.IconImageVariants, reader.PublicID)
	}
	if got := readerIconURL(t, env.getReader(t, fixture.admin, reader.PublicID).IconImageVariants); got != "" {
		t.Fatalf("GetReader icon after the removal = %q, want empty", got)
	}
	comments := fixture.list(t, &publiraadminv1.ListCommentsRequest{})
	if len(comments.Comments) != 1 || len(comments.Comments[0].AuthorIconImageVariants) != 0 {
		t.Fatalf("listed comments after the removal = %+v, want the one comment with no author icon", comments.Comments)
	}
	// The image is left unelected rather than deleted, which is what the
	// orphan sweep reclaims.
	if count := env.countRows(t, "SELECT count(*) FROM users WHERE id = $1 AND icon_image_id IS NULL", reader.ID); count != 1 {
		t.Fatal("the account still elects an icon after the removal")
	}
	if count := env.countRows(t, "SELECT count(*) FROM user_images WHERE user_id = $1", reader.ID); count != 1 {
		t.Fatalf("user_images rows after the removal = %d, want the one image left for the orphan sweep", count)
	}

	// The storefront's comment list shows the author's icon, so the removal
	// owes it a drop.
	wantTag := commentListRevalidateTag(fixture.admin.Tenant.ID, fixture.episode.PublicID)
	if tags := env.revalidatedTags(t, fixture.admin.Tenant); !slices.Contains(tags, wantTag) {
		t.Fatalf("recorded invalidations = %v, want %s", tags, wantTag)
	}

	// A second removal finds nothing to remove and records nothing.
	if again := env.removeReaderIcon(t, fixture.admin, reader.ID); len(again.IconImageVariants) != 0 {
		t.Fatalf("RemoveReaderIcon with no icon = %v, want no icon", again.IconImageVariants)
	}
	logs := env.readerAuditLogs(t, fixture.admin)
	if len(logs) != 1 {
		t.Fatalf("audit log count = %d, want 1 (%+v)", len(logs), logs)
	}
	assertReaderAuditLog(t, logs[0], "reader_icon_removed", fixture.admin, reader.PublicID)
}

func TestDBAdminRemoveReaderIconLeavesOtherTenantsAlone(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "RIOTENANT001", "reader-icon-scope.example.com", "Scope", "RIOADMIN0001", "admin@reader-icon-scope.example.com")
	other := env.seedTenantWithAdmin(t, "RIXTENANT001", "reader-icon-scope-other.example.com", "Other", "RIXADMIN0001", "admin@reader-icon-scope-other.example.com")
	outsider := env.PG.SeedEndUser(t, other.Tenant.ID, "RIXREADER001", "reader@reader-icon-scope-other.example.com", "Outsider")
	url := env.seedReaderIcon(t, other.Tenant, outsider)

	for _, readerID := range []string{outsider.ID.String(), uuid.Must(uuid.NewV7()).String()} {
		if _, err := env.userClient().RemoveReaderIcon(testutil.WithBearer(context.Background(), admin.token()), &publiraadminv1.RemoveReaderIconRequest{
			Tenant:   admin.tenantContext(),
			ReaderId: readerID,
		}); connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("RemoveReaderIcon %s error = %v, want not_found", readerID, err)
		}
	}

	if got := readerIconURL(t, env.getReader(t, other, outsider.PublicID).IconImageVariants); got != url {
		t.Fatalf("icon of the other tenant's reader = %q, want %q untouched", got, url)
	}
	if logs := env.readerAuditLogs(t, admin); len(logs) != 0 {
		t.Fatalf("audit log count = %d, want 0 (%+v)", len(logs), logs)
	}
}
