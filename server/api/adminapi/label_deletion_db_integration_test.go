package adminapi

import (
	"context"
	"fmt"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/outbox"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/testutil"
)

// labelDeletionFixture is a tenant with an admin, a reader, and a counter for
// the public IDs the rows a test seeds need.
type labelDeletionFixture struct {
	env    *adminDBEnv
	admin  adminDBTenant
	reader testutil.TenantUser
	next   int
}

func newLabelDeletionFixture(t *testing.T, env *adminDBEnv) *labelDeletionFixture {
	t.Helper()

	admin := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAADMIN01", "admin@tenant-a.example.com")
	return &labelDeletionFixture{
		env:    env,
		admin:  admin,
		reader: env.PG.SeedEndUser(t, admin.Tenant.ID, "READER01", "reader@example.com", "Reader"),
	}
}

// publicID answers a public ID no other row of the test has.
func (f *labelDeletionFixture) publicID(prefix string) string {
	f.next++
	return fmt.Sprintf("%s%06d", prefix, f.next)
}

func (f *labelDeletionFixture) label(t *testing.T, name string) testutil.Label {
	t.Helper()
	return f.env.PG.SeedLabel(t, f.admin.Tenant.ID, testutil.LabelSeed{PublicID: f.publicID("LBDEL"), Name: name})
}

func (f *labelDeletionFixture) exec(t *testing.T, query string, args ...any) {
	t.Helper()
	if _, err := f.env.PG.DB.ExecContext(context.Background(), query, args...); err != nil {
		t.Fatalf("exec %q: %v", query, err)
	}
}

func (f *labelDeletionFixture) delete(as adminDBTenant, label testutil.Label) error {
	_, err := f.env.labelClient().DeleteLabel(testutil.WithBearer(context.Background(), as.token()), &publiraadminv1.DeleteLabelRequest{
		Tenant:  as.tenantContext(),
		LabelId: label.ID.String(),
	})
	return err
}

// promotionCode seeds a 10% code for the label, deleted when deleted is set,
// and answers its ID.
func (f *labelDeletionFixture) promotionCode(t *testing.T, labelID uuid.UUID, deleted bool) uuid.UUID {
	t.Helper()
	id := uuid.Must(uuid.NewV7())
	var deletedAt any
	if deleted {
		deletedAt = time.Now()
	}
	f.exec(t, "INSERT INTO promotion_codes (id, tenant_id, code, discount_kind, discount_value, target_kind, target_id, deleted_at) VALUES ($1, $2, $3, 'percent', 10, 'label', $4, $5)",
		id, f.admin.Tenant.ID, f.publicID("CODE"), labelID, deletedAt)
	return id
}

// A label nothing refers to goes with its eye-catch and the codes for it that
// were deleted unused, leaves the search index and the storefront's cached
// label pages owing a refresh, and is named in the audit log by its name.
// Another label stays as it was.
func TestDBDeleteLabelTakesWhatIsItsOwn(t *testing.T) {
	f := newLabelDeletionFixture(t, newReaderIconDBEnv(t))
	tenantID := f.admin.Tenant.ID
	label := f.label(t, "Label with a typo")
	kept := f.label(t, "Label to keep")

	imageID := uuid.Must(uuid.NewV7())
	f.exec(t, "INSERT INTO label_images (id, tenant_id, label_id) VALUES ($1, $2, $3)", imageID, tenantID, label.ID)
	f.exec(t, `INSERT INTO label_image_variants (id, tenant_id, label_image_id, label, variant_type, storage_provider, object_key, content_type, file_size_bytes, width, height)
		VALUES ($1, $2, $3, 'portrait-1x', 'portrait', 's3', 'tenants/x/labels/eye-catch.webp', 'image/webp', 10, 1, 1)`, uuid.Must(uuid.NewV7()), tenantID, imageID)
	f.exec(t, "UPDATE labels SET eye_catch_image_id = $1 WHERE id = $2", imageID, label.ID)
	f.promotionCode(t, label.ID, true)
	keptCode := f.promotionCode(t, kept.ID, false)

	if err := f.delete(f.admin, label); err != nil {
		t.Fatalf("DeleteLabel: %v", err)
	}

	for _, table := range []string{
		"labels WHERE id = $1",
		"label_images WHERE label_id = $1",
		"label_surfaces WHERE label_id = $1",
		"promotion_codes WHERE target_id = $1",
		"sitemap_entries WHERE id = $1",
	} {
		if got := f.env.countRows(t, "SELECT count(*) FROM "+table, label.ID); got != 0 {
			t.Errorf("rows left in %s = %d, want 0", table, got)
		}
	}
	if got := f.env.countRows(t, "SELECT count(*) FROM label_image_variants WHERE label_image_id = $1", imageID); got != 0 {
		t.Errorf("image variants left = %d, want 0", got)
	}

	// What else the tenant had is as it was.
	if got := f.env.countRows(t, "SELECT count(*) FROM labels WHERE id = $1", kept.ID); got != 1 {
		t.Errorf("the other label is gone")
	}
	if got := f.env.countRows(t, "SELECT count(*) FROM promotion_codes WHERE id = $1", keptCode); got != 1 {
		t.Errorf("the other label's promotion code is gone")
	}

	// The search index loses the label.
	if got := f.env.countRows(t,
		"SELECT count(*) FROM outbox_events WHERE event_type = $1 AND payload->>'kind' = 'label' AND payload->>'id' = $2",
		outbox.EventTypeCatalogIndexSync, label.ID.String(),
	); got != 1 {
		t.Errorf("label search syncs queued = %d, want 1", got)
	}
	if tags, want := f.env.revalidatedTags(t, f.admin.Tenant), fmt.Sprintf("tenant:%s:labels", tenantID); !slices.Contains(tags, want) {
		t.Errorf("cache tags recorded = %v, want %s among them", tags, want)
	}
	if got := f.env.countRows(t,
		"SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = 'label_deleted' AND target_type = 'label' AND target_id = $2 AND reason = $3",
		tenantID, label.PublicID, "Label with a typo",
	); got != 1 {
		t.Errorf("audit entries naming the deletion = %d, want 1", got)
	}

	// A request delivered again finds nothing to delete.
	if err := f.delete(f.admin, label); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("DeleteLabel again = %v, want not_found", err)
	}
}

// A label something refers to stays, and the refusal names the first such
// reference in the order the RPC documents.
func TestDBDeleteLabelRefusesWhatRefersToIt(t *testing.T) {
	t.Parallel()

	f := newLabelDeletionFixture(t, newAdminDBEnv(t))
	tenantID := f.admin.Tenant.ID
	planOf := func(t *testing.T, label testutil.Label) {
		f.env.PG.SeedSubscriptionPlan(t, tenantID, testutil.SubscriptionPlanSeed{Name: "Label pass", StripePriceID: f.publicID("price_"), PriceAmount: 500, Scope: "label", LabelIDs: []uuid.UUID{label.ID}})
	}

	cases := []struct {
		name string
		seed func(t *testing.T, label testutil.Label)
		want string
	}{
		{"an unpublished series", func(t *testing.T, label testutil.Label) {
			f.env.PG.SeedSeries(t, tenantID, testutil.SeriesSeed{PublicID: f.publicID("SR"), Title: "Draft series", LabelID: label.ID})
		}, rpcerrors.ReasonLabelHasSeries},
		{"a subscription plan scoped to it", planOf, rpcerrors.ReasonLabelInSubscriptionPlan},
		{"a live promotion code", func(t *testing.T, label testutil.Label) {
			f.promotionCode(t, label.ID, false)
		}, rpcerrors.ReasonLabelInPromotionCode},
		{"a deleted promotion code someone redeemed", func(t *testing.T, label testutil.Label) {
			codeID := f.promotionCode(t, label.ID, true)
			// The redemption is of a purchase in a series under another label,
			// where the series has moved since, so nothing but the code ties
			// it to this one.
			other := f.label(t, "Other label")
			series := f.env.PG.SeedSeries(t, tenantID, testutil.SeriesSeed{PublicID: f.publicID("SR"), Title: "Moved series", LabelID: other.ID, Published: true})
			episode := f.env.PG.SeedEpisode(t, tenantID, series.ID, testutil.EpisodeSeed{PublicID: f.publicID("EP"), Title: "Chapter", Price: 120, Status: testutil.EpisodeStatusPublished})
			purchaseID := uuid.Must(uuid.NewV7())
			f.exec(t, "INSERT INTO purchases (id, tenant_id, user_id, episode_id, currency, price_at_purchase) VALUES ($1, $2, $3, $4, $5, 120)",
				purchaseID, tenantID, f.reader.ID, episode.ID, f.env.PG.TenantCurrency(t, tenantID))
			f.exec(t, "INSERT INTO promotion_code_redemptions (id, tenant_id, promotion_code_id, purchase_id, user_id) VALUES ($1, $2, $3, $4, $5)",
				uuid.Must(uuid.NewV7()), tenantID, codeID, purchaseID, f.reader.ID)
		}, rpcerrors.ReasonLabelInPromotionCode},
		{"a plan scoped to it and a live promotion code", func(t *testing.T, label testutil.Label) {
			f.promotionCode(t, label.ID, false)
			planOf(t, label)
		}, rpcerrors.ReasonLabelInSubscriptionPlan},
		{"a plan scoped to it and a series", func(t *testing.T, label testutil.Label) {
			planOf(t, label)
			f.env.PG.SeedSeries(t, tenantID, testutil.SeriesSeed{PublicID: f.publicID("SR"), Title: "Series", LabelID: label.ID, Published: true})
		}, rpcerrors.ReasonLabelHasSeries},
	}
	for _, tc := range cases {
		label := f.label(t, "Label with "+tc.name)
		tc.seed(t, label)

		err := f.delete(f.admin, label)
		if reason := errorInfoReason(t, err); connect.CodeOf(err) != connect.CodeFailedPrecondition || reason != tc.want {
			t.Errorf("DeleteLabel of a label with %s = %v (reason %q), want failed_precondition %s", tc.name, err, reason, tc.want)
		}
		if got := f.env.countRows(t, "SELECT count(*) FROM labels WHERE id = $1", label.ID); got != 1 {
			t.Errorf("the label with %s is gone", tc.name)
		}
	}
	if got := f.env.countRows(t, "SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = 'label_deleted'", tenantID); got != 0 {
		t.Errorf("audit entries for refused deletions = %d, want 0", got)
	}

	// An Editor may not delete even a label nothing refers to.
	editor := f.env.PG.SeedTenantUser(t, tenantID, "TAEDITOR1", "editor@tenant-a.example.com", "Editor", "tenant_editor")
	empty := f.label(t, "Empty label")
	if err := f.delete(f.admin.as(editor), empty); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("DeleteLabel as an Editor = %v, want permission_denied", err)
	}
	if got := f.env.countRows(t, "SELECT count(*) FROM labels WHERE id = $1", empty.ID); got != 1 {
		t.Fatalf("an Editor's request deleted the label")
	}

	// Another tenant's label is not one this tenant can name.
	other := f.env.seedTenantWithAdmin(t, "TENANTB", "tenant-b.example.com", "Tenant B", "TBADMIN01", "admin@tenant-b.example.com")
	foreign := f.env.PG.SeedLabel(t, other.Tenant.ID, testutil.LabelSeed{PublicID: "LABELB1", Name: "Label B"})
	if err := f.delete(f.admin, foreign); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("DeleteLabel of another tenant's label = %v, want not_found", err)
	}
	if got := f.env.countRows(t, "SELECT count(*) FROM labels WHERE id = $1", foreign.ID); got != 1 {
		t.Fatalf("another tenant's label is gone")
	}
}

// A promotion code created for a label while the label is being deleted
// either lands first and refuses the deletion, or finds the label gone: it is
// never left naming a label that no longer exists.
func TestDBDeleteLabelHoldsOffANewPromotionCode(t *testing.T) {
	t.Parallel()

	f := newLabelDeletionFixture(t, newAdminDBEnv(t))
	label := f.label(t, "Label raced by a code")

	ctx := context.Background()
	tx, err := f.env.PG.DB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback() //nolint:errcheck
	if _, err := tx.ExecContext(ctx, "SELECT 1 FROM labels WHERE id = $1 FOR UPDATE", label.ID); err != nil {
		t.Fatalf("lock the label as a deletion does: %v", err)
	}

	created := make(chan error, 1)
	go func() {
		_, err := f.env.promotionCodeClient().CreatePromotionCode(testutil.WithBearer(ctx, f.admin.token()), &publiraadminv1.CreatePromotionCodeRequest{
			Tenant:        f.admin.tenantContext(),
			Code:          "RACE10",
			DiscountKind:  publiraadminv1.PromotionCodeDiscountKind_PROMOTION_CODE_DISCOUNT_KIND_PERCENT,
			DiscountValue: 10,
			TargetKind:    publiraadminv1.PromotionCodeTargetKind_PROMOTION_CODE_TARGET_KIND_LABEL,
			TargetId:      label.ID.String(),
		})
		created <- err
	}()

	select {
	case err := <-created:
		t.Fatalf("CreatePromotionCode did not wait for the label lock: %v", err)
	case <-time.After(500 * time.Millisecond):
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM labels WHERE id = $1", label.ID); err != nil {
		t.Fatalf("delete the label: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit: %v", err)
	}

	if err := <-created; connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("CreatePromotionCode for a label deleted meanwhile = %v, want invalid_argument", err)
	}
	if got := f.env.countRows(t, "SELECT count(*) FROM promotion_codes WHERE target_id = $1", label.ID); got != 0 {
		t.Fatalf("codes naming the deleted label = %d, want 0", got)
	}
}
