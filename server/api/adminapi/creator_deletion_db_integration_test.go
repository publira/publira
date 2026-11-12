package adminapi

import (
	"context"
	"fmt"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/creatorroles"
	"github.com/publira/publira/server/internal/outbox"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/testutil"
)

// creatorDeletionFixture is a tenant with an admin, a reader, and a counter
// for the public IDs the rows a test seeds need.
type creatorDeletionFixture struct {
	env    *adminDBEnv
	admin  adminDBTenant
	reader testutil.TenantUser
	next   int
}

func newCreatorDeletionFixture(t *testing.T, env *adminDBEnv) *creatorDeletionFixture {
	t.Helper()

	admin := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAADMIN01", "admin@tenant-a.example.com")
	return &creatorDeletionFixture{
		env:    env,
		admin:  admin,
		reader: env.PG.SeedEndUser(t, admin.Tenant.ID, "READER01", "reader@example.com", "Reader"),
	}
}

// publicID answers a public ID no other row of the test has.
func (f *creatorDeletionFixture) publicID(prefix string) string {
	f.next++
	return fmt.Sprintf("%s%06d", prefix, f.next)
}

func (f *creatorDeletionFixture) creator(t *testing.T, name string) testutil.Creator {
	t.Helper()
	return f.env.PG.SeedCreator(t, f.admin.Tenant.ID, testutil.CreatorSeed{PublicID: f.publicID("CRDEL"), Name: name})
}

func (f *creatorDeletionFixture) exec(t *testing.T, query string, args ...any) {
	t.Helper()
	if _, err := f.env.PG.DB.ExecContext(context.Background(), query, args...); err != nil {
		t.Fatalf("exec %q: %v", query, err)
	}
}

func (f *creatorDeletionFixture) delete(as adminDBTenant, creator testutil.Creator) error {
	_, err := f.env.creatorClient().DeleteCreator(testutil.WithBearer(context.Background(), as.token()), &publiraadminv1.DeleteCreatorRequest{
		Tenant:    as.tenantContext(),
		CreatorId: creator.ID.String(),
	})
	return err
}

// A creator nothing refers to goes with their icon, the follows of them, and
// their follower count, leaves the search index and the storefront's cached
// creator pages owing a refresh, and is named in the audit log by their name.
// Another creator stays as they were.
func TestDBDeleteCreatorTakesWhatIsTheirOwn(t *testing.T) {
	f := newCreatorDeletionFixture(t, newReaderIconDBEnv(t))
	tenantID := f.admin.Tenant.ID
	creator := f.creator(t, "Author with a typo")
	kept := f.creator(t, "Author to keep")

	imageID := uuid.Must(uuid.NewV7())
	f.exec(t, "INSERT INTO creator_images (id, tenant_id, creator_id) VALUES ($1, $2, $3)", imageID, tenantID, creator.ID)
	f.exec(t, `INSERT INTO creator_image_variants (id, tenant_id, creator_image_id, label, storage_provider, object_key, content_type, file_size_bytes, width, height)
		VALUES ($1, $2, $3, 'original', 's3', 'tenants/x/creators/icon.webp', 'image/webp', 10, 256, 256)`, uuid.Must(uuid.NewV7()), tenantID, imageID)
	f.exec(t, "UPDATE creators SET icon_image_id = $1 WHERE id = $2", imageID, creator.ID)
	f.exec(t, "INSERT INTO creator_follows (tenant_id, user_id, creator_id) VALUES ($1, $2, $3)", tenantID, f.reader.ID, creator.ID)
	f.exec(t, "INSERT INTO creator_follows (tenant_id, user_id, creator_id) VALUES ($1, $2, $3)", tenantID, f.reader.ID, kept.ID)

	if err := f.delete(f.admin, creator); err != nil {
		t.Fatalf("DeleteCreator: %v", err)
	}

	for _, table := range []string{
		"creators WHERE id = $1",
		"creator_images WHERE creator_id = $1",
		"creator_follows WHERE creator_id = $1",
		"creator_follower_counts WHERE creator_id = $1",
		"sitemap_entries WHERE id = $1",
	} {
		if got := f.env.countRows(t, "SELECT count(*) FROM "+table, creator.ID); got != 0 {
			t.Errorf("rows left in %s = %d, want 0", table, got)
		}
	}
	if got := f.env.countRows(t, "SELECT count(*) FROM creator_image_variants WHERE creator_image_id = $1", imageID); got != 0 {
		t.Errorf("image variants left = %d, want 0", got)
	}

	// What else the tenant had is as it was.
	if got := f.env.countRows(t, "SELECT count(*) FROM creators WHERE id = $1", kept.ID); got != 1 {
		t.Errorf("the other creator is gone")
	}
	if got := f.env.countRows(t, "SELECT count FROM creator_follower_counts WHERE creator_id = $1", kept.ID); got != 1 {
		t.Errorf("the other creator's follower count = %d, want 1", got)
	}

	// The search index loses the creator.
	if got := f.env.countRows(t,
		"SELECT count(*) FROM outbox_events WHERE event_type = $1 AND payload->>'kind' = 'creator' AND payload->>'id' = $2",
		outbox.EventTypeCatalogIndexSync, creator.ID.String(),
	); got != 1 {
		t.Errorf("creator search syncs queued = %d, want 1", got)
	}
	if tags, want := f.env.revalidatedTags(t, f.admin.Tenant), fmt.Sprintf("tenant:%s:creators", tenantID); !slices.Contains(tags, want) {
		t.Errorf("cache tags recorded = %v, want %s among them", tags, want)
	}
	if got := f.env.countRows(t,
		"SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = 'creator_deleted' AND target_type = 'creator' AND target_id = $2 AND reason = $3",
		tenantID, creator.PublicID, "Author with a typo",
	); got != 1 {
		t.Errorf("audit entries naming the deletion = %d, want 1", got)
	}

	// A request delivered again finds nothing to delete.
	if err := f.delete(f.admin, creator); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("DeleteCreator again = %v, want not_found", err)
	}
}

// A creator something refers to stays, and the refusal names the first such
// reference in the order the RPC documents.
func TestDBDeleteCreatorRefusesWhatRefersToThem(t *testing.T) {
	t.Parallel()

	f := newCreatorDeletionFixture(t, newAdminDBEnv(t))
	tenantID := f.admin.Tenant.ID
	series := func(t *testing.T) testutil.Series {
		return f.env.PG.SeedSeries(t, tenantID, testutil.SeriesSeed{PublicID: f.publicID("SR"), Title: "Draft series"})
	}
	statementLine := func(t *testing.T, creator testutil.Creator) {
		statementID := uuid.Must(uuid.NewV7())
		period := fmt.Sprintf("2026-%02d-01", f.next%12+1)
		f.exec(t, `INSERT INTO royalty_statements (id, tenant_id, period, time_zone, total_gross, total_refunded, total_payout, starts_at, ends_at, currency, total_adjustment)
			VALUES ($1, $2, $3::date, 'UTC', 120, 0, 60, $3::date, $3::date + interval '1 month', $4, 0)`,
			statementID, tenantID, period, f.env.PG.TenantCurrency(t, tenantID))
		// The episode the line was for is gone, as a line outlives it, so
		// nothing but the line ties the statement to the creator.
		f.exec(t, `INSERT INTO royalty_statement_lines (tenant_id, statement_id, line_number, creator_id, creator_name, series_title, episode_id, episode_title, sale_count, gross_amount, refunded_amount, share_bps, payout_amount)
			VALUES ($1, $2, 1, $3, $4, 'Series A', $5, 'Chapter 1', 1, 120, 0, 5000, 60)`, tenantID, statementID, creator.ID, creator.Name, uuid.Must(uuid.NewV7()))
	}
	linked := func(t *testing.T, creator testutil.Creator) {
		f.env.PG.SeedCreatorAccount(t, tenantID, creator.ID, f.reader.ID)
	}

	cases := []struct {
		name string
		seed func(t *testing.T, creator testutil.Creator)
		want string
	}{
		{"a credit on an unpublished series", func(t *testing.T, creator testutil.Creator) {
			f.env.PG.SeedSeriesCreator(t, tenantID, series(t).ID, creator.ID, "")
		}, rpcerrors.ReasonCreatorCredited},
		{"a credit on an episode alone", func(t *testing.T, creator testutil.Creator) {
			episode := f.env.PG.SeedEpisode(t, tenantID, series(t).ID, testutil.EpisodeSeed{PublicID: f.publicID("EP"), Title: "Chapter"})
			f.env.PG.SeedEpisodeCreator(t, tenantID, episode.ID, creator.ID, "")
		}, rpcerrors.ReasonCreatorCredited},
		{"a royalty statement line", statementLine, rpcerrors.ReasonCreatorOnRoyaltyStatement},
		{"a linked reader account", linked, rpcerrors.ReasonCreatorHasLinkedAccount},
		{"a linked account and a statement line", func(t *testing.T, creator testutil.Creator) {
			linked(t, creator)
			statementLine(t, creator)
		}, rpcerrors.ReasonCreatorOnRoyaltyStatement},
		{"a statement line and a credit", func(t *testing.T, creator testutil.Creator) {
			statementLine(t, creator)
			f.env.PG.SeedSeriesCreator(t, tenantID, series(t).ID, creator.ID, "")
		}, rpcerrors.ReasonCreatorCredited},
	}
	for _, tc := range cases {
		creator := f.creator(t, "Author with "+tc.name)
		tc.seed(t, creator)

		err := f.delete(f.admin, creator)
		if reason := errorInfoReason(t, err); connect.CodeOf(err) != connect.CodeFailedPrecondition || reason != tc.want {
			t.Errorf("DeleteCreator of an author with %s = %v (reason %q), want failed_precondition %s", tc.name, err, reason, tc.want)
		}
		if got := f.env.countRows(t, "SELECT count(*) FROM creators WHERE id = $1", creator.ID); got != 1 {
			t.Errorf("the author with %s is gone", tc.name)
		}
	}
	if got := f.env.countRows(t, "SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = 'creator_deleted'", tenantID); got != 0 {
		t.Errorf("audit entries for refused deletions = %d, want 0", got)
	}

	// An Editor may not delete even a creator nothing refers to.
	editor := f.env.PG.SeedTenantUser(t, tenantID, "TAEDITOR1", "editor@tenant-a.example.com", "Editor", "tenant_editor")
	unused := f.creator(t, "Unused author")
	if err := f.delete(f.admin.as(editor), unused); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("DeleteCreator as an Editor = %v, want permission_denied", err)
	}
	if got := f.env.countRows(t, "SELECT count(*) FROM creators WHERE id = $1", unused.ID); got != 1 {
		t.Fatalf("an Editor's request deleted the creator")
	}

	// Another tenant's creator is not one this tenant can name.
	other := f.env.seedTenantWithAdmin(t, "TENANTB", "tenant-b.example.com", "Tenant B", "TBADMIN01", "admin@tenant-b.example.com")
	foreign := f.env.PG.SeedCreator(t, other.Tenant.ID, testutil.CreatorSeed{PublicID: "CREATORB1", Name: "Author B"})
	if err := f.delete(f.admin, foreign); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("DeleteCreator of another tenant's creator = %v, want not_found", err)
	}
	if got := f.env.countRows(t, "SELECT count(*) FROM creators WHERE id = $1", foreign.ID); got != 1 {
		t.Fatalf("another tenant's creator is gone")
	}
}

// A credit written while the creator is being deleted is either refused by its
// foreign key or lands first, and then the deletion waits for it and refuses:
// the deletion never answers from before the credit committed.
func TestDBDeleteCreatorWaitsForACreditBeingWritten(t *testing.T) {
	t.Parallel()

	f := newCreatorDeletionFixture(t, newAdminDBEnv(t))
	tenantID := f.admin.Tenant.ID
	creator := f.creator(t, "Author raced by a credit")
	series := f.env.PG.SeedSeries(t, tenantID, testutil.SeriesSeed{PublicID: f.publicID("SR"), Title: "Series"})
	role := f.env.PG.CreatorRoleByName(t, tenantID, creatorroles.Defaults[0].Name)

	ctx := context.Background()
	tx, err := f.env.PG.DB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback() //nolint:errcheck
	// The insert takes a key share lock on the creator row through its
	// foreign key, as every credit write does.
	if _, err := tx.ExecContext(ctx, "INSERT INTO series_creators (series_id, creator_id, role_id, display_order, tenant_id) VALUES ($1, $2, $3, 0, $4)",
		series.ID, creator.ID, role.ID, tenantID); err != nil {
		t.Fatalf("credit the creator: %v", err)
	}

	deleted := make(chan error, 1)
	go func() { deleted <- f.delete(f.admin, creator) }()

	select {
	case err := <-deleted:
		t.Fatalf("DeleteCreator did not wait for the credit being written: %v", err)
	case <-time.After(500 * time.Millisecond):
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit: %v", err)
	}

	err = <-deleted
	if reason := errorInfoReason(t, err); connect.CodeOf(err) != connect.CodeFailedPrecondition || reason != rpcerrors.ReasonCreatorCredited {
		t.Fatalf("DeleteCreator of an author credited meanwhile = %v (reason %q), want failed_precondition %s", err, reason, rpcerrors.ReasonCreatorCredited)
	}
	if got := f.env.countRows(t, "SELECT count(*) FROM series_creators WHERE creator_id = $1", creator.ID); got != 1 {
		t.Fatalf("credits naming the creator = %d, want 1", got)
	}
}
