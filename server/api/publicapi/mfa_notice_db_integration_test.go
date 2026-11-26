package publicapi

import (
	"encoding/json"
	"slices"
	"testing"

	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/mfaflow"
	"github.com/publira/publira/server/internal/outbox"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// consoleMfaChangeNotices lists, oldest first, the changes the console's
// second factor notices queued for user.
func consoleMfaChangeNotices(t *testing.T, env *mfaDBEnv, user testutil.TenantUser) []mfaflow.Change {
	t.Helper()

	rows, err := env.PG.DB.QueryContext(t.Context(),
		`SELECT payload FROM outbox_events WHERE event_type = $1 AND tenant_id = $2 ORDER BY idempotency_key`,
		outbox.EventTypeAdminMfaChangedNoticeEmail, env.tenant.ID)
	if err != nil {
		t.Fatalf("query outbox_events: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	var changes []mfaflow.Change
	for rows.Next() {
		var body []byte
		if err := rows.Scan(&body); err != nil {
			t.Fatalf("scan outbox_events: %v", err)
		}
		var payload outbox.AdminMfaChangedNoticeEmailPayload
		if err := json.Unmarshal(body, &payload); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		if payload.UserID == user.ID.String() {
			changes = append(changes, mfaflow.Change(payload.Change))
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate outbox_events: %v", err)
	}
	return changes
}

// changeFactorOnTheSite enrolls user's authenticator on the site, replaces its
// recovery codes, and takes it off again.
func changeFactorOnTheSite(t *testing.T, env *mfaDBEnv, user testutil.TenantUser) {
	t.Helper()

	secret, _ := env.enroll(t, user)
	regenerated, err := env.authClient().RegenerateMfaRecoveryCodes(env.session(t, user), &publirav1.RegenerateMfaRecoveryCodesRequest{
		Tenant: tenantContext(env.tenant),
		Code:   mfaCode(t, secret, 1),
	})
	if err != nil {
		t.Fatalf("RegenerateMfaRecoveryCodes: %v", err)
	}
	if _, err := env.authClient().DisableMfa(env.session(t, user), &publirav1.DisableMfaRequest{
		Tenant:   tenantContext(env.tenant),
		Password: testutil.SeededPassword,
		Code:     regenerated.RecoveryCodes[0],
	}); err != nil {
		t.Fatalf("DisableMfa: %v", err)
	}
}

// The authenticator and the recovery codes a member of staff holds are the
// console account's, so changing them on the site tells the account as the
// console would.
func TestDBMfaChangesOnTheSiteNoticeAConsoleAccount(t *testing.T) {
	t.Parallel()

	env := newMfaDBEnv(t)
	staff := env.PG.SeedTenantUser(t, env.tenant.ID, "MFASTAFFA002", "admin@tenant-a.example.com", "Admin", auth.RoleTenantAdmin)
	changeFactorOnTheSite(t, env, staff)

	want := []mfaflow.Change{mfaflow.ChangeTotpEnabled, mfaflow.ChangeRecoveryCodesRegenerated, mfaflow.ChangeTotpDisabled}
	if got := consoleMfaChangeNotices(t, env, staff); !slices.Equal(got, want) {
		t.Fatalf("queued notices = %v, want %v", got, want)
	}
}

func TestDBMfaChangesOnTheSiteNoticeNoReader(t *testing.T) {
	t.Parallel()

	env := newMfaDBEnv(t)
	changeFactorOnTheSite(t, env, env.reader)

	if got := consoleMfaChangeNotices(t, env, env.reader); len(got) != 0 {
		t.Fatalf("queued notices = %v, want none for a reader", got)
	}
}
