package adminapi

import (
	"context"
	"slices"
	"strings"
	"testing"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/auth"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
)

const (
	testFingerprintA = "14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5"
	testFingerprintB = "A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90:A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90"
)

func getDBTenantMobileAppAssociation(t *testing.T, env *adminDBEnv, tenant adminDBTenant) *publiraadminv1.TenantMobileAppAssociation {
	t.Helper()

	resp, err := env.tenantSettingsClient().GetTenantMobileAppAssociation(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.GetTenantMobileAppAssociationRequest{
		Tenant: tenant.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("GetTenantMobileAppAssociation: %v", err)
	}
	return resp.Msg.Association
}

func updateDBTenantMobileAppAssociation(
	env *adminDBEnv,
	tenant adminDBTenant,
	association *publiraadminv1.TenantMobileAppAssociation,
) (*publiraadminv1.TenantMobileAppAssociation, error) {
	resp, err := env.tenantSettingsClient().UpdateTenantMobileAppAssociation(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UpdateTenantMobileAppAssociationRequest{
		Tenant:      tenant.tenantContext(),
		Association: association,
	}))
	if err != nil {
		return nil, err
	}
	return resp.Msg.Association, nil
}

func assertAndroidAssociation(t *testing.T, label string, got *publiraadminv1.TenantAndroidAppAssociation, wantApplicationID string, wantFingerprints ...string) {
	t.Helper()

	if got == nil {
		t.Fatalf("%s: android = nil, want %s", label, wantApplicationID)
	}
	if got.ApplicationId != wantApplicationID || !slices.Equal(got.Sha256CertFingerprints, wantFingerprints) {
		t.Fatalf("%s: android = %v, want %s with %v", label, got, wantApplicationID, wantFingerprints)
	}
}

func assertIosAssociation(t *testing.T, label string, got *publiraadminv1.TenantIosAppAssociation, wantTeamID, wantBundleIdentifier string) {
	t.Helper()

	if got == nil {
		t.Fatalf("%s: ios = nil, want %s.%s", label, wantTeamID, wantBundleIdentifier)
	}
	if got.TeamId != wantTeamID || got.BundleIdentifier != wantBundleIdentifier {
		t.Fatalf("%s: ios = %v, want %s.%s", label, got, wantTeamID, wantBundleIdentifier)
	}
}

// A tenant without an app reads as having none; both platforms are stored and
// read back normalized, replaced, and cleared one at a time.
func TestDBTenantMobileAppAssociationIsStoredReadBackAndCleared(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")

	if got := getDBTenantMobileAppAssociation(t, env, tenant); got.Android != nil || got.Ios != nil {
		t.Fatalf("initial association = %v, want none", got)
	}

	saved, err := updateDBTenantMobileAppAssociation(env, tenant, &publiraadminv1.TenantMobileAppAssociation{
		Android: &publiraadminv1.TenantAndroidAppAssociation{
			ApplicationId:          " com.example.reader ",
			Sha256CertFingerprints: []string{strings.ToLower(testFingerprintA), testFingerprintB},
		},
		Ios: &publiraadminv1.TenantIosAppAssociation{
			TeamId:           "abcde12345",
			BundleIdentifier: "com.example.Reader",
		},
	})
	if err != nil {
		t.Fatalf("UpdateTenantMobileAppAssociation: %v", err)
	}
	assertAndroidAssociation(t, "saved", saved.Android, "com.example.reader", testFingerprintA, testFingerprintB)
	assertIosAssociation(t, "saved", saved.Ios, "ABCDE12345", "com.example.Reader")

	read := getDBTenantMobileAppAssociation(t, env, tenant)
	assertAndroidAssociation(t, "read", read.Android, "com.example.reader", testFingerprintA, testFingerprintB)
	assertIosAssociation(t, "read", read.Ios, "ABCDE12345", "com.example.Reader")

	// Leaving iOS out clears it, and the Android fingerprints are replaced
	// rather than added to.
	androidOnly, err := updateDBTenantMobileAppAssociation(env, tenant, &publiraadminv1.TenantMobileAppAssociation{
		Android: &publiraadminv1.TenantAndroidAppAssociation{
			ApplicationId:          "com.example.reader",
			Sha256CertFingerprints: []string{testFingerprintB},
		},
	})
	if err != nil {
		t.Fatalf("UpdateTenantMobileAppAssociation without iOS: %v", err)
	}
	assertAndroidAssociation(t, "android only", androidOnly.Android, "com.example.reader", testFingerprintB)
	if androidOnly.Ios != nil {
		t.Fatalf("ios after leaving it out = %v, want none", androidOnly.Ios)
	}

	cleared, err := updateDBTenantMobileAppAssociation(env, tenant, nil)
	if err != nil {
		t.Fatalf("UpdateTenantMobileAppAssociation clearing both: %v", err)
	}
	if cleared.Android != nil || cleared.Ios != nil {
		t.Fatalf("association after clearing = %v, want none", cleared)
	}
	if got := getDBTenantMobileAppAssociation(t, env, tenant); got.Android != nil || got.Ios != nil {
		t.Fatalf("association read after clearing = %v, want none", got)
	}
}

// A refused save leaves what was stored alone.
func TestDBTenantMobileAppAssociationRefusesAnInvalidIdentity(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	valid := func() *publiraadminv1.TenantMobileAppAssociation {
		return &publiraadminv1.TenantMobileAppAssociation{
			Android: &publiraadminv1.TenantAndroidAppAssociation{
				ApplicationId:          "com.example.reader",
				Sha256CertFingerprints: []string{testFingerprintA},
			},
			Ios: &publiraadminv1.TenantIosAppAssociation{TeamId: "ABCDE12345", BundleIdentifier: "com.example.reader"},
		}
	}
	if _, err := updateDBTenantMobileAppAssociation(env, tenant, valid()); err != nil {
		t.Fatalf("UpdateTenantMobileAppAssociation: %v", err)
	}

	for name, mutate := range map[string]func(*publiraadminv1.TenantMobileAppAssociation){
		"an android app without an application ID": func(a *publiraadminv1.TenantMobileAppAssociation) { a.Android.ApplicationId = "" },
		"an android app without a fingerprint":     func(a *publiraadminv1.TenantMobileAppAssociation) { a.Android.Sha256CertFingerprints = nil },
		"a SHA-1 fingerprint": func(a *publiraadminv1.TenantMobileAppAssociation) {
			a.Android.Sha256CertFingerprints = []string{"DA:39:A3:EE:5E:6B:4B:0D:32:55:BF:EF:95:60:18:90:AF:D8:07:09"}
		},
		"an ios app without a team ID":           func(a *publiraadminv1.TenantMobileAppAssociation) { a.Ios.TeamId = "" },
		"an ios app without a bundle identifier": func(a *publiraadminv1.TenantMobileAppAssociation) { a.Ios.BundleIdentifier = "" },
	} {
		association := valid()
		mutate(association)
		if _, err := updateDBTenantMobileAppAssociation(env, tenant, association); connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("saving %s: code = %v, want invalid_argument (err=%v)", name, connect.CodeOf(err), err)
		}
	}

	read := getDBTenantMobileAppAssociation(t, env, tenant)
	assertAndroidAssociation(t, "after refused saves", read.Android, "com.example.reader", testFingerprintA)
	assertIosAssociation(t, "after refused saves", read.Ios, "ABCDE12345", "com.example.reader")
}

func TestDBUpdateTenantMobileAppAssociationRequiresTenantAdmin(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	editor := env.PG.SeedTenantUser(t, tenant.Tenant.ID, "TAUSER02", "editor@tenant-a.example.com", "Tenant A Editor", auth.RoleTenantEditor)

	_, err := updateDBTenantMobileAppAssociation(env, tenant.as(editor), &publiraadminv1.TenantMobileAppAssociation{
		Ios: &publiraadminv1.TenantIosAppAssociation{TeamId: "ABCDE12345", BundleIdentifier: "com.example.reader"},
	})
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("code = %v, want permission_denied (err=%v)", connect.CodeOf(err), err)
	}
	if got := getDBTenantMobileAppAssociation(t, env, tenant); got.Ios != nil {
		t.Fatalf("ios after a refused save = %v, want none", got.Ios)
	}
}

// One tenant's apps are never another's: each reads back only what it saved,
// and an admin session cannot write to a tenant it does not belong to.
func TestDBTenantMobileAppAssociationIsIsolatedPerTenant(t *testing.T) {
	env := newAdminDBEnv(t)
	first, second := seedTwoTenants(t, env)

	if _, err := updateDBTenantMobileAppAssociation(env, first, &publiraadminv1.TenantMobileAppAssociation{
		Android: &publiraadminv1.TenantAndroidAppAssociation{
			ApplicationId:          "com.tenant_a.reader",
			Sha256CertFingerprints: []string{testFingerprintA},
		},
		Ios: &publiraadminv1.TenantIosAppAssociation{TeamId: "AAAAA11111", BundleIdentifier: "com.tenant-a.reader"},
	}); err != nil {
		t.Fatalf("UpdateTenantMobileAppAssociation for the first tenant: %v", err)
	}
	if _, err := updateDBTenantMobileAppAssociation(env, second, &publiraadminv1.TenantMobileAppAssociation{
		Ios: &publiraadminv1.TenantIosAppAssociation{TeamId: "BBBBB22222", BundleIdentifier: "com.tenant-b.reader"},
	}); err != nil {
		t.Fatalf("UpdateTenantMobileAppAssociation for the second tenant: %v", err)
	}

	firstRead := getDBTenantMobileAppAssociation(t, env, first)
	assertAndroidAssociation(t, "first tenant", firstRead.Android, "com.tenant_a.reader", testFingerprintA)
	assertIosAssociation(t, "first tenant", firstRead.Ios, "AAAAA11111", "com.tenant-a.reader")
	secondRead := getDBTenantMobileAppAssociation(t, env, second)
	if secondRead.Android != nil {
		t.Fatalf("second tenant android = %v, want none", secondRead.Android)
	}
	assertIosAssociation(t, "second tenant", secondRead.Ios, "BBBBB22222", "com.tenant-b.reader")

	_, err := env.tenantSettingsClient().UpdateTenantMobileAppAssociation(context.Background(), newAdminDBRequest(first, &publiraadminv1.UpdateTenantMobileAppAssociationRequest{
		Tenant: second.tenantContext(),
	}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("UpdateTenantMobileAppAssociation with another tenant's context: code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}
	assertIosAssociation(t, "second tenant after another tenant's admin tried to clear it", getDBTenantMobileAppAssociation(t, env, second).Ios, "BBBBB22222", "com.tenant-b.reader")
}
