package adminapi

import (
	"context"
	"slices"
	"strings"
	"testing"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/auth"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/testutil"
)

func getDBTenantSiteVerification(t *testing.T, env *adminDBEnv, tenant adminDBTenant) *publiraadminv1.TenantSiteVerification {
	t.Helper()

	resp, err := env.tenantSettingsClient().GetTenantSiteVerification(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.GetTenantSiteVerificationRequest{
		Tenant: tenant.tenantContext(),
	})
	if err != nil {
		t.Fatalf("GetTenantSiteVerification: %v", err)
	}
	return resp.SiteVerification
}

func updateDBTenantSiteVerification(
	env *adminDBEnv,
	tenant adminDBTenant,
	codes *publiraadminv1.TenantSiteVerification,
) (*publiraadminv1.TenantSiteVerification, error) {
	resp, err := env.tenantSettingsClient().UpdateTenantSiteVerification(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.UpdateTenantSiteVerificationRequest{
		Tenant:           tenant.tenantContext(),
		SiteVerification: codes,
	})
	if err != nil {
		return nil, err
	}
	return resp.SiteVerification, nil
}

func assertSiteVerification(t *testing.T, label string, got, want *publiraadminv1.TenantSiteVerification) {
	t.Helper()

	if got.GetGoogleSiteVerification() != want.GetGoogleSiteVerification() ||
		got.GetBingSiteVerification() != want.GetBingSiteVerification() {
		t.Fatalf("%s: site verification = %v, want %v", label, got, want)
	}
}

// A tenant that has saved nothing reads as having no code, and each code is
// stored trimmed, read back, and cleared on its own.
func TestDBTenantSiteVerificationIsStoredReadBackAndCleared(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")

	assertSiteVerification(t, "initial", getDBTenantSiteVerification(t, env, tenant), &publiraadminv1.TenantSiteVerification{})

	saved, err := updateDBTenantSiteVerification(env, tenant, &publiraadminv1.TenantSiteVerification{
		GoogleSiteVerification: "  AbC-123_xyzGoogleCode \n",
		BingSiteVerification:   "\t0123456789ABCDEF0123456789ABCDEF ",
	})
	if err != nil {
		t.Fatalf("UpdateTenantSiteVerification: %v", err)
	}
	want := &publiraadminv1.TenantSiteVerification{
		GoogleSiteVerification: "AbC-123_xyzGoogleCode",
		BingSiteVerification:   "0123456789ABCDEF0123456789ABCDEF",
	}
	assertSiteVerification(t, "saved", saved, want)
	assertSiteVerification(t, "read", getDBTenantSiteVerification(t, env, tenant), want)

	cleared, err := updateDBTenantSiteVerification(env, tenant, &publiraadminv1.TenantSiteVerification{
		BingSiteVerification: "0123456789ABCDEF0123456789ABCDEF",
	})
	if err != nil {
		t.Fatalf("UpdateTenantSiteVerification clearing the Google code: %v", err)
	}
	want = &publiraadminv1.TenantSiteVerification{BingSiteVerification: "0123456789ABCDEF0123456789ABCDEF"}
	assertSiteVerification(t, "Google code cleared", cleared, want)
	assertSiteVerification(t, "read after clearing the Google code", getDBTenantSiteVerification(t, env, tenant), want)

	if _, err := updateDBTenantSiteVerification(env, tenant, &publiraadminv1.TenantSiteVerification{
		GoogleSiteVerification: "AbC-123_xyzGoogleCode",
		BingSiteVerification:   "   ",
	}); err != nil {
		t.Fatalf("UpdateTenantSiteVerification clearing the Bing code: %v", err)
	}
	assertSiteVerification(t, "read after clearing the Bing code", getDBTenantSiteVerification(t, env, tenant), &publiraadminv1.TenantSiteVerification{
		GoogleSiteVerification: "AbC-123_xyzGoogleCode",
	})

	if _, err := updateDBTenantSiteVerification(env, tenant, &publiraadminv1.TenantSiteVerification{}); err != nil {
		t.Fatalf("UpdateTenantSiteVerification clearing both codes: %v", err)
	}
	assertSiteVerification(t, "read after clearing both codes", getDBTenantSiteVerification(t, env, tenant), &publiraadminv1.TenantSiteVerification{})
}

// Anything but the bare code is refused, a whole <meta> element among them,
// and a refused save leaves what was stored alone.
func TestDBTenantSiteVerificationRefusesAnythingButTheBareCode(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	valid := func() *publiraadminv1.TenantSiteVerification {
		return &publiraadminv1.TenantSiteVerification{
			GoogleSiteVerification: "AbC-123_xyzGoogleCode",
			BingSiteVerification:   "0123456789ABCDEF0123456789ABCDEF",
		}
	}
	if _, err := updateDBTenantSiteVerification(env, tenant, valid()); err != nil {
		t.Fatalf("UpdateTenantSiteVerification: %v", err)
	}

	for name, raw := range map[string]string{
		"a less-than sign":     "abc<def",
		"a double quote":       `abc"def`,
		"a single quote":       "abc'def",
		"an inner space":       "abc def",
		"a whole meta element": `<meta name="google-site-verification" content="AbC-123_xyzGoogleCode" />`,
		"a code too long":      strings.Repeat("a", 129),
	} {
		for field, mutate := range map[string]func(*publiraadminv1.TenantSiteVerification){
			"Google": func(s *publiraadminv1.TenantSiteVerification) { s.GoogleSiteVerification = raw },
			"Bing":   func(s *publiraadminv1.TenantSiteVerification) { s.BingSiteVerification = raw },
		} {
			codes := valid()
			mutate(codes)
			if _, err := updateDBTenantSiteVerification(env, tenant, codes); connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("saving %s as the %s code: code = %v, want invalid_argument (err=%v)", name, field, connect.CodeOf(err), err)
			}
		}
	}
	if _, err := updateDBTenantSiteVerification(env, tenant, nil); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("saving no codes: code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}

	assertSiteVerification(t, "after refused saves", getDBTenantSiteVerification(t, env, tenant), valid())
}

// Both RPCs belong to a tenant admin: an auditor or an editor can neither read
// nor write the codes.
func TestDBTenantSiteVerificationRequiresTenantAdmin(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	editor := env.PG.SeedTenantUser(t, tenant.Tenant.ID, "TAUSER02", "editor@tenant-a.example.com", "Tenant A Editor", auth.RoleTenantEditor)
	auditor := env.PG.SeedTenantUser(t, tenant.Tenant.ID, "TAUSER03", "auditor@tenant-a.example.com", "Tenant A Auditor", auth.RoleTenantAuditor)

	for _, seat := range []adminDBTenant{tenant.as(editor), tenant.as(auditor)} {
		_, err := env.tenantSettingsClient().GetTenantSiteVerification(testutil.WithBearer(context.Background(), seat.token()), &publiraadminv1.GetTenantSiteVerificationRequest{
			Tenant: seat.tenantContext(),
		})
		if connect.CodeOf(err) != connect.CodePermissionDenied {
			t.Fatalf("GetTenantSiteVerification as %s: code = %v, want permission_denied (err=%v)", seat.User.Role, connect.CodeOf(err), err)
		}
		_, err = updateDBTenantSiteVerification(env, seat, &publiraadminv1.TenantSiteVerification{GoogleSiteVerification: "AbC-123_xyzGoogleCode"})
		if connect.CodeOf(err) != connect.CodePermissionDenied {
			t.Fatalf("UpdateTenantSiteVerification as %s: code = %v, want permission_denied (err=%v)", seat.User.Role, connect.CodeOf(err), err)
		}
	}
	assertSiteVerification(t, "after refused saves", getDBTenantSiteVerification(t, env, tenant), &publiraadminv1.TenantSiteVerification{})
}

// Every change drops the storefront's cache of the read that carries the
// codes, and saving what the tenant already has changes nothing and drops
// nothing.
func TestDBTenantSiteVerificationRevalidatesTheStorefrontTag(t *testing.T) {
	env := newReaderIconDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TSVTENANT01", "site-verification.example.com", "Revalidate", "TSVADMIN001", "admin@site-verification.example.com")
	tag := "tenant:" + tenant.Tenant.ID.String() + ":analytics-settings"
	codes := &publiraadminv1.TenantSiteVerification{GoogleSiteVerification: "AbC-123_xyzGoogleCode"}

	if _, err := updateDBTenantSiteVerification(env, tenant, codes); err != nil {
		t.Fatalf("UpdateTenantSiteVerification: %v", err)
	}
	if got := env.takeRevalidatedTags(t, tenant.Tenant); !slices.Equal(got, []string{tag}) {
		t.Fatalf("invalidations recorded by a change = %v, want %v", got, []string{tag})
	}
	if _, err := updateDBTenantSiteVerification(env, tenant, codes); err != nil {
		t.Fatalf("UpdateTenantSiteVerification saving again: %v", err)
	}
	if got := env.takeRevalidatedTags(t, tenant.Tenant); len(got) != 0 {
		t.Fatalf("invalidations recorded by an unchanged save = %v, want none", got)
	}
}
