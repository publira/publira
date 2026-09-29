package dbtest

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/lib/pq"

	"github.com/publira/publira/server/internal/testutil"
)

// A tenant has no app on either platform until it states one, and a platform
// is stored whole or not at all, in the formats the association documents need.
func TestTenantMobileAppAssociationDefaultsAndChecks(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "MOBILETN0001", "mobile.example.com", "admin-mobile.example.com", "Mobile Tenant")
	if _, err := pg.DB.ExecContext(ctx, `INSERT INTO tenant_config (tenant_id) VALUES ($1)`, tenantID); err != nil {
		t.Fatalf("insert tenant_config: %v", err)
	}

	var applicationID, teamID, bundleIdentifier sql.NullString
	var fingerprints []string
	if err := pg.DB.QueryRowContext(ctx, `
		SELECT android_application_id, android_sha256_cert_fingerprints, ios_team_id, ios_bundle_identifier
		FROM tenant_config WHERE tenant_id = $1
	`, tenantID).Scan(&applicationID, pq.Array(&fingerprints), &teamID, &bundleIdentifier); err != nil {
		t.Fatalf("read tenant_config: %v", err)
	}
	if applicationID.Valid || len(fingerprints) != 0 || teamID.Valid || bundleIdentifier.Valid {
		t.Fatalf("association = %v, %v, %v, %v, want none", applicationID, fingerprints, teamID, bundleIdentifier)
	}

	const fingerprint = "14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5"
	const setAndroid = `UPDATE tenant_config SET android_application_id = $2, android_sha256_cert_fingerprints = $3 WHERE tenant_id = $1`
	if _, err := pg.DB.ExecContext(ctx, setAndroid, tenantID, "com.example.reader", pq.Array([]string{fingerprint, fingerprint[:len(fingerprint)-2] + "00"})); err != nil {
		t.Fatalf("set android association: %v", err)
	}
	for name, args := range map[string][]any{
		"an application ID without a fingerprint": {"com.example.reader", pq.Array([]string{})},
		"fingerprints without an application ID":  {nil, pq.Array([]string{fingerprint})},
		"a single-segment application ID":         {"reader", pq.Array([]string{fingerprint})},
		"a lowercase fingerprint":                 {"com.example.reader", pq.Array([]string{"14:6d:e9:83:c5:73:06:50:d8:ee:b9:95:2f:34:fc:64:16:a0:83:42:e6:1d:be:a8:8a:04:96:b2:3f:cf:44:e5"})},
		"a fingerprint without colons":            {"com.example.reader", pq.Array([]string{"146DE983C5730650D8EEB9952F34FC6416A08342E61DBEA88A0496B23FCF44E5"})},
		"a null fingerprint":                      {"com.example.reader", pq.Array([]sql.NullString{{String: fingerprint, Valid: true}, {}})},
	} {
		_, err := pg.DB.ExecContext(ctx, setAndroid, append([]any{tenantID}, args...)...)
		if want := "tenant_config_android_app_association_check"; !isCheckViolation(err) || checkName(err) != want {
			t.Fatalf("%s: error = %v (%s), want %s", name, err, checkName(err), want)
		}
	}

	const setIos = `UPDATE tenant_config SET ios_team_id = $2, ios_bundle_identifier = $3 WHERE tenant_id = $1`
	if _, err := pg.DB.ExecContext(ctx, setIos, tenantID, "ABCDE12345", "com.example.reader"); err != nil {
		t.Fatalf("set ios association: %v", err)
	}
	for name, args := range map[string][]any{
		"a team ID without a bundle identifier": {"ABCDE12345", nil},
		"a bundle identifier without a team ID": {nil, "com.example.reader"},
		"a lowercase team ID":                   {"abcde12345", "com.example.reader"},
		"a single-segment bundle identifier":    {"ABCDE12345", "reader"},
	} {
		_, err := pg.DB.ExecContext(ctx, setIos, append([]any{tenantID}, args...)...)
		if want := "tenant_config_ios_app_association_check"; !isCheckViolation(err) || checkName(err) != want {
			t.Fatalf("%s: error = %v (%s), want %s", name, err, checkName(err), want)
		}
	}
}
