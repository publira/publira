package publicapi

import (
	"context"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"github.com/lib/pq"

	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

const (
	testFingerprintA = "14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5"
	testFingerprintB = "A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90:A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90"
)

// seedMobileAppAssociation stores a tenant's app identities through the
// superuser connection, since tenant_config sits behind RLS. An empty
// application ID or team ID leaves that platform unconfigured.
func seedMobileAppAssociation(
	t *testing.T,
	env *publicDBEnv,
	tenant testutil.Tenant,
	androidApplicationID string,
	fingerprints []string,
	iosTeamID, iosBundleIdentifier string,
) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if fingerprints == nil {
		fingerprints = []string{}
	}
	if _, err := env.PG.DB.ExecContext(ctx, `
		INSERT INTO tenant_config (tenant_id, android_application_id, android_sha256_cert_fingerprints, ios_team_id, ios_bundle_identifier)
		VALUES ($1, NULLIF($2, ''), $3, NULLIF($4, ''), NULLIF($5, ''))
	`, tenant.ID, androidApplicationID, pq.Array(fingerprints), iosTeamID, iosBundleIdentifier); err != nil {
		t.Fatalf("insert tenant_config for %s: %v", tenant.PublicID, err)
	}
}

func getDBMobileAppAssociation(t *testing.T, env *publicDBEnv, tenant testutil.Tenant) *publirav1.GetTenantMobileAppAssociationResponse {
	t.Helper()

	resp, err := env.tenantAPIClient().GetTenantMobileAppAssociation(context.Background(), connect.NewRequest(&publirav1.GetTenantMobileAppAssociationRequest{
		Tenant: tenantContext(tenant),
	}))
	if err != nil {
		t.Fatalf("GetTenantMobileAppAssociation: %v", err)
	}
	return resp.Msg
}

// Each tenant reads back only the apps it configured, with every fingerprint
// and nothing standing in for a platform it left unconfigured.
func TestDBGetTenantMobileAppAssociationAnswersEachTenantItsOwnApps(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)
	seedMobileAppAssociation(t, env, first, "com.tenant_a.reader", []string{testFingerprintA, testFingerprintB}, "AAAAA11111", "com.tenant-a.reader")
	seedMobileAppAssociation(t, env, second, "", nil, "BBBBB22222", "com.tenant-b.reader")

	got := getDBMobileAppAssociation(t, env, first)
	if got.GetAndroid().GetApplicationId() != "com.tenant_a.reader" ||
		!slices.Equal(got.GetAndroid().GetSha256CertFingerprints(), []string{testFingerprintA, testFingerprintB}) {
		t.Fatalf("tenant A android = %v, want com.tenant_a.reader with both fingerprints", got.GetAndroid())
	}
	if got.GetIos().GetTeamId() != "AAAAA11111" || got.GetIos().GetBundleIdentifier() != "com.tenant-a.reader" {
		t.Fatalf("tenant A ios = %v, want AAAAA11111.com.tenant-a.reader", got.GetIos())
	}

	other := getDBMobileAppAssociation(t, env, second)
	if other.Android != nil {
		t.Fatalf("tenant B android = %v, want none", other.Android)
	}
	if other.GetIos().GetTeamId() != "BBBBB22222" || other.GetIos().GetBundleIdentifier() != "com.tenant-b.reader" {
		t.Fatalf("tenant B ios = %v, want BBBBB22222.com.tenant-b.reader", other.GetIos())
	}
}

func TestDBGetTenantMobileAppAssociationAnswersNoAppWithoutAConfigRow(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	if got := getDBMobileAppAssociation(t, env, tenant); got.Android != nil || got.Ios != nil {
		t.Fatalf("association = %v, want none", got)
	}
}

func TestDBGetTenantMobileAppAssociationRejectsAnUnknownTenant(t *testing.T) {
	env := newPublicDBEnv(t)
	env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	_, err := env.tenantAPIClient().GetTenantMobileAppAssociation(context.Background(), connect.NewRequest(&publirav1.GetTenantMobileAppAssociationRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: uuid.Must(uuid.NewV7()).String()},
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
}
