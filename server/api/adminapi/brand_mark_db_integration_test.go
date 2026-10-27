package adminapi

import (
	"context"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/auth"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/testutil"
)

const (
	testBadgeGuidelinesURL        = "https://example.com/badge-guidelines"
	testRevisedBadgeGuidelinesURL = "https://example.com/badge-guidelines/2026"
)

func TestDBTenantBrandMarkUploadReplaceAndDelete(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	marks := env.brandMarkClient()
	ctx := testutil.WithBearer(context.Background(), tenant.token())

	empty, err := marks.ListTenantBrandMarks(ctx, &publiraadminv1.ListTenantBrandMarksRequest{Tenant: tenant.tenantContext()})
	if err != nil {
		t.Fatalf("ListTenantBrandMarks: %v", err)
	}
	if len(empty.BrandMarks) != 0 {
		t.Fatalf("brand marks before an upload = %v, want none", empty.BrandMarks)
	}

	before := time.Now().Add(-time.Second)
	uploaded, err := marks.UploadTenantBrandMark(ctx, &publiraadminv1.UploadTenantBrandMarkRequest{
		Tenant:           tenant.tenantContext(),
		Kind:             publirattypesv1.TenantBrandMarkKind_TENANT_BRAND_MARK_KIND_APP_STORE_BADGE,
		ImageData:        brandingSourcePNG(t, 120, 20),
		ImageContentType: "image/png",
		TermsUrl:         testBadgeGuidelinesURL,
		TermsAccepted:    true,
	})
	if err != nil {
		t.Fatalf("UploadTenantBrandMark: %v", err)
	}
	first := uploaded.BrandMark
	if first.GetMark().GetKind() != publirattypesv1.TenantBrandMarkKind_TENANT_BRAND_MARK_KIND_APP_STORE_BADGE {
		t.Fatalf("kind = %s, want APP_STORE_BADGE", first.GetMark().GetKind())
	}
	firstURL := brandingImageURL(first.GetMark().GetImageVariants())
	if !strings.HasPrefix(firstURL, "/images/tenants/") || !strings.HasSuffix(firstURL, "/app_store_badge") {
		t.Fatalf("variant url = %q, want a /images/tenants/{id}/app_store_badge URL", firstURL)
	}
	if first.GetMark().GetTermsUrl() != testBadgeGuidelinesURL {
		t.Fatalf("terms_url = %q, want %q", first.GetMark().GetTermsUrl(), testBadgeGuidelinesURL)
	}
	acceptedAt, err := time.Parse(time.RFC3339, first.GetMark().GetTermsAcceptedAt())
	if err != nil || acceptedAt.Before(before) {
		t.Fatalf("terms_accepted_at = %q, want the time of the upload", first.GetMark().GetTermsAcceptedAt())
	}
	if first.GetTermsAcceptedByUserPublicId() != tenant.User.PublicID || first.GetTermsAcceptedByUserName() != tenant.User.Name {
		t.Fatalf("accepted by = %q (%q), want %q (%q)", first.GetTermsAcceptedByUserPublicId(), first.GetTermsAcceptedByUserName(), tenant.User.PublicID, tenant.User.Name)
	}
	if got := env.countRows(t,
		"SELECT count(*) FROM tenant_image_variants WHERE tenant_id = $1 AND variant_type = 'app_store_badge' AND width = 120 AND height = 20 AND content_type = 'image/png'",
		tenant.Tenant.ID); got != 1 {
		t.Fatalf("app_store_badge variants stored as a 120x20 PNG = %d, want 1", got)
	}

	// A second administrator replaces the badge under revised guidelines: the
	// image and the whole consent record are theirs now.
	other := tenant.as(env.PG.SeedTenantUser(t, tenant.Tenant.ID, "TAUSER02", "second@tenant-a.example.com", "Second Admin", auth.RoleTenantAdmin))
	replaced, err := marks.UploadTenantBrandMark(testutil.WithBearer(context.Background(), other.token()), &publiraadminv1.UploadTenantBrandMarkRequest{
		Tenant:           other.tenantContext(),
		Kind:             publirattypesv1.TenantBrandMarkKind_TENANT_BRAND_MARK_KIND_APP_STORE_BADGE,
		ImageData:        brandingSourcePNG(t, 360, 120),
		ImageContentType: "image/png",
		TermsUrl:         testRevisedBadgeGuidelinesURL,
		TermsAccepted:    true,
	})
	if err != nil {
		t.Fatalf("UploadTenantBrandMark (replace): %v", err)
	}
	if got := brandingImageURL(replaced.BrandMark.GetMark().GetImageVariants()); got == firstURL {
		t.Fatalf("variant url did not change on replace: %q", got)
	}
	if replaced.BrandMark.GetMark().GetTermsUrl() != testRevisedBadgeGuidelinesURL {
		t.Fatalf("terms_url after replace = %q, want %q", replaced.BrandMark.GetMark().GetTermsUrl(), testRevisedBadgeGuidelinesURL)
	}
	if replaced.BrandMark.GetTermsAcceptedByUserPublicId() != "TAUSER02" {
		t.Fatalf("accepted by after replace = %q, want TAUSER02", replaced.BrandMark.GetTermsAcceptedByUserPublicId())
	}
	if got := env.countRows(t, "SELECT count(*) FROM tenant_images WHERE tenant_id = $1", tenant.Tenant.ID); got != 1 {
		t.Fatalf("tenant_images rows after replace = %d, want the replacement alone", got)
	}
	if got := env.countRows(t, "SELECT count(*) FROM tenant_brand_marks WHERE tenant_id = $1", tenant.Tenant.ID); got != 1 {
		t.Fatalf("tenant_brand_marks rows after replace = %d, want 1", got)
	}

	listed, err := marks.ListTenantBrandMarks(ctx, &publiraadminv1.ListTenantBrandMarksRequest{Tenant: tenant.tenantContext()})
	if err != nil {
		t.Fatalf("ListTenantBrandMarks: %v", err)
	}
	if len(listed.BrandMarks) != 1 || brandingImageURL(listed.BrandMarks[0].GetMark().GetImageVariants()) != brandingImageURL(replaced.BrandMark.GetMark().GetImageVariants()) {
		t.Fatalf("listed brand marks = %v, want the replacement alone", listed.BrandMarks)
	}

	if _, err := marks.DeleteTenantBrandMark(ctx, &publiraadminv1.DeleteTenantBrandMarkRequest{
		Tenant: tenant.tenantContext(),
		Kind:   publirattypesv1.TenantBrandMarkKind_TENANT_BRAND_MARK_KIND_APP_STORE_BADGE,
	}); err != nil {
		t.Fatalf("DeleteTenantBrandMark: %v", err)
	}
	if got := env.countRows(t, "SELECT count(*) FROM tenant_brand_marks WHERE tenant_id = $1", tenant.Tenant.ID); got != 0 {
		t.Fatalf("tenant_brand_marks rows after delete = %d, want 0", got)
	}
	if got := env.countRows(t, "SELECT count(*) FROM tenant_images WHERE tenant_id = $1", tenant.Tenant.ID); got != 0 {
		t.Fatalf("tenant_images rows after delete = %d, want 0", got)
	}

	// Deleting a kind with nothing uploaded writes nothing, the audit log
	// included.
	if _, err := marks.DeleteTenantBrandMark(ctx, &publiraadminv1.DeleteTenantBrandMarkRequest{
		Tenant: tenant.tenantContext(),
		Kind:   publirattypesv1.TenantBrandMarkKind_TENANT_BRAND_MARK_KIND_APP_STORE_BADGE,
	}); err != nil {
		t.Fatalf("DeleteTenantBrandMark (nothing uploaded): %v", err)
	}
	for action, want := range map[string]int{"tenant_brand_mark_uploaded": 2, "tenant_brand_mark_deleted": 1} {
		if got := env.countRows(t,
			"SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = $2 AND target_type = 'tenant_branding' AND target_id = 'app_store_badge'",
			tenant.Tenant.ID, action); got != want {
			t.Fatalf("%s audit entries = %d, want %d", action, got, want)
		}
	}
}

func TestDBTenantBrandMarkUploadWithoutTheTermsAcceptedStoresNothing(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	ctx := testutil.WithBearer(context.Background(), tenant.token())

	_, err := env.brandMarkClient().UploadTenantBrandMark(ctx, &publiraadminv1.UploadTenantBrandMarkRequest{
		Tenant:           tenant.tenantContext(),
		Kind:             publirattypesv1.TenantBrandMarkKind_TENANT_BRAND_MARK_KIND_X_SHARE,
		ImageData:        brandingSourcePNG(t, 64, 64),
		ImageContentType: "image/png",
		TermsUrl:         testBadgeGuidelinesURL,
	})
	if connect.CodeOf(err) != connect.CodeFailedPrecondition || errorInfoReason(t, err) != rpcerrors.ReasonBrandMarkTermsNotAccepted {
		t.Fatalf("UploadTenantBrandMark without the terms accepted = %v, want failed_precondition %s", err, rpcerrors.ReasonBrandMarkTermsNotAccepted)
	}
	for _, table := range []string{"tenant_brand_marks", "tenant_images", "audit_logs"} {
		if got := env.countRows(t, "SELECT count(*) FROM "+table+" WHERE tenant_id = $1", tenant.Tenant.ID); got != 0 {
			t.Fatalf("%s rows after a refused upload = %d, want 0", table, got)
		}
	}
}

func TestDBTenantBrandMarksAreKeptPerKindAndPerTenant(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	first := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	second := env.seedTenantWithAdmin(t, "TENANTB", "tenant-b.example.com", "Tenant B", "TBUSER01", "admin@tenant-b.example.com")
	marks := env.brandMarkClient()
	firstCtx := testutil.WithBearer(context.Background(), first.token())

	for _, kind := range []publirattypesv1.TenantBrandMarkKind{
		publirattypesv1.TenantBrandMarkKind_TENANT_BRAND_MARK_KIND_X_SHARE,
		publirattypesv1.TenantBrandMarkKind_TENANT_BRAND_MARK_KIND_LINE_SHARE,
	} {
		if _, err := marks.UploadTenantBrandMark(firstCtx, &publiraadminv1.UploadTenantBrandMarkRequest{
			Tenant:           first.tenantContext(),
			Kind:             kind,
			ImageData:        brandingSourcePNG(t, 64, 64),
			ImageContentType: "image/png",
			TermsUrl:         testBadgeGuidelinesURL,
			TermsAccepted:    true,
		}); err != nil {
			t.Fatalf("UploadTenantBrandMark(%s): %v", kind, err)
		}
	}
	if _, err := marks.DeleteTenantBrandMark(firstCtx, &publiraadminv1.DeleteTenantBrandMarkRequest{
		Tenant: first.tenantContext(),
		Kind:   publirattypesv1.TenantBrandMarkKind_TENANT_BRAND_MARK_KIND_X_SHARE,
	}); err != nil {
		t.Fatalf("DeleteTenantBrandMark: %v", err)
	}

	listed, err := marks.ListTenantBrandMarks(firstCtx, &publiraadminv1.ListTenantBrandMarksRequest{Tenant: first.tenantContext()})
	if err != nil {
		t.Fatalf("ListTenantBrandMarks: %v", err)
	}
	if len(listed.BrandMarks) != 1 || listed.BrandMarks[0].GetMark().GetKind() != publirattypesv1.TenantBrandMarkKind_TENANT_BRAND_MARK_KIND_LINE_SHARE {
		t.Fatalf("brand marks after deleting the X mark = %v, want the LINE mark alone", listed.BrandMarks)
	}

	other, err := marks.ListTenantBrandMarks(testutil.WithBearer(context.Background(), second.token()), &publiraadminv1.ListTenantBrandMarksRequest{Tenant: second.tenantContext()})
	if err != nil {
		t.Fatalf("ListTenantBrandMarks (other tenant): %v", err)
	}
	if len(other.BrandMarks) != 0 {
		t.Fatalf("other tenant's brand marks = %v, want none", other.BrandMarks)
	}
}

// A deleted account leaves the consent record in place, naming no one.
func TestDBTenantBrandMarkOutlivesTheAccountThatAcceptedIt(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	departing := tenant.as(env.PG.SeedTenantUser(t, tenant.Tenant.ID, "TAUSER02", "departing@tenant-a.example.com", "Departing Admin", auth.RoleTenantAdmin))
	marks := env.brandMarkClient()

	if _, err := marks.UploadTenantBrandMark(testutil.WithBearer(context.Background(), departing.token()), &publiraadminv1.UploadTenantBrandMarkRequest{
		Tenant:           departing.tenantContext(),
		Kind:             publirattypesv1.TenantBrandMarkKind_TENANT_BRAND_MARK_KIND_GOOGLE_SIGN_IN,
		ImageData:        brandingSourcePNG(t, 64, 64),
		ImageContentType: "image/png",
		TermsUrl:         testBadgeGuidelinesURL,
		TermsAccepted:    true,
	}); err != nil {
		t.Fatalf("UploadTenantBrandMark: %v", err)
	}
	// The audit entry the upload wrote holds the account too.
	if _, err := env.PG.DB.ExecContext(context.Background(), "DELETE FROM audit_logs WHERE tenant_id = $1", tenant.Tenant.ID); err != nil {
		t.Fatalf("delete audit entries: %v", err)
	}
	if _, err := env.PG.DB.ExecContext(context.Background(), "DELETE FROM users WHERE id = $1", departing.User.ID); err != nil {
		t.Fatalf("delete account: %v", err)
	}

	listed, err := marks.ListTenantBrandMarks(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.ListTenantBrandMarksRequest{Tenant: tenant.tenantContext()})
	if err != nil {
		t.Fatalf("ListTenantBrandMarks: %v", err)
	}
	if len(listed.BrandMarks) != 1 {
		t.Fatalf("brand marks = %v, want the one uploaded", listed.BrandMarks)
	}
	mark := listed.BrandMarks[0]
	if mark.GetTermsAcceptedByUserPublicId() != "" || mark.GetTermsAcceptedByUserName() != "" {
		t.Fatalf("accepted by = %q (%q), want no one", mark.GetTermsAcceptedByUserPublicId(), mark.GetTermsAcceptedByUserName())
	}
	if mark.GetMark().GetTermsUrl() != testBadgeGuidelinesURL || mark.GetMark().GetTermsAcceptedAt() == "" {
		t.Fatalf("consent = %q at %q, want the URL and the time kept", mark.GetMark().GetTermsUrl(), mark.GetMark().GetTermsAcceptedAt())
	}
}
