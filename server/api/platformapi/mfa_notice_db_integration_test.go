package platformapi

import (
	"context"
	"encoding/json"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/mfaflow"
	"github.com/publira/publira/server/internal/outbox"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
)

// operatorMfaChangeNotices lists, oldest first, the changes the second factor
// notices queued for operatorID name.
func operatorMfaChangeNotices(t *testing.T, env *operatorMfaEnv, operatorID uuid.UUID) []mfaflow.Change {
	t.Helper()

	rows, err := env.pg.DB.QueryContext(context.Background(),
		`SELECT payload FROM outbox_events WHERE event_type = $1 AND tenant_id IS NULL ORDER BY idempotency_key`,
		outbox.EventTypePlatformMfaChangedNoticeEmail)
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
		var payload outbox.PlatformMfaChangedNoticeEmailPayload
		if err := json.Unmarshal(body, &payload); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		if payload.PlatformUserID != operatorID.String() {
			t.Fatalf("notice operator = %q, want %s", payload.PlatformUserID, operatorID)
		}
		if _, err := time.Parse(time.RFC3339Nano, payload.ChangedAt); err != nil {
			t.Fatalf("notice changed_at = %q: %v", payload.ChangedAt, err)
		}
		changes = append(changes, mfaflow.Change(payload.Change))
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate outbox_events: %v", err)
	}
	return changes
}

func assertOperatorMfaChangeNotices(t *testing.T, env *operatorMfaEnv, operatorID uuid.UUID, want ...mfaflow.Change) {
	t.Helper()

	if got := operatorMfaChangeNotices(t, env, operatorID); !slices.Equal(got, want) {
		t.Fatalf("queued notices = %v, want %v", got, want)
	}
}

// Every change a signed-in operator makes to their second factor queues one
// notice of it, and a change the server refuses queues none.
func TestDBOperatorMfaChangesEachQueueOneNotice(t *testing.T) {
	t.Parallel()

	env := newOperatorMfaEnv(t)
	operatorID := env.operator.ID

	started, err := env.auth.StartMfaEnrollment(env.session(), &publirasplatformv1.PlatformAuthServiceStartMfaEnrollmentRequest{})
	if err != nil {
		t.Fatalf("StartMfaEnrollment: %v", err)
	}
	if _, err := env.auth.ConfirmMfaEnrollment(env.session(), &publirasplatformv1.PlatformAuthServiceConfirmMfaEnrollmentRequest{Code: "000000"}); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("ConfirmMfaEnrollment with a wrong code = %v, want unauthenticated", err)
	}
	assertOperatorMfaChangeNotices(t, env, operatorID)

	if _, err := env.auth.ConfirmMfaEnrollment(env.session(), &publirasplatformv1.PlatformAuthServiceConfirmMfaEnrollmentRequest{
		Code: operatorMfaCode(t, started.Secret, 0),
	}); err != nil {
		t.Fatalf("ConfirmMfaEnrollment: %v", err)
	}
	assertOperatorMfaChangeNotices(t, env, operatorID, mfaflow.ChangeTotpEnabled)

	if _, err := env.auth.RegenerateMfaRecoveryCodes(env.session(), &publirasplatformv1.PlatformAuthServiceRegenerateMfaRecoveryCodesRequest{Code: "000000"}); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("RegenerateMfaRecoveryCodes with a wrong code = %v, want unauthenticated", err)
	}
	regenerated, err := env.auth.RegenerateMfaRecoveryCodes(env.session(), &publirasplatformv1.PlatformAuthServiceRegenerateMfaRecoveryCodesRequest{
		Code: operatorMfaCode(t, started.Secret, 1),
	})
	if err != nil {
		t.Fatalf("RegenerateMfaRecoveryCodes: %v", err)
	}
	assertOperatorMfaChangeNotices(t, env, operatorID, mfaflow.ChangeTotpEnabled, mfaflow.ChangeRecoveryCodesRegenerated)

	if _, err := env.auth.DisableMfa(env.session(), &publirasplatformv1.PlatformAuthServiceDisableMfaRequest{Code: "000000"}); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("DisableMfa with a wrong code = %v, want unauthenticated", err)
	}
	if _, err := env.auth.DisableMfa(env.session(), &publirasplatformv1.PlatformAuthServiceDisableMfaRequest{
		Code: regenerated.RecoveryCodes[0],
	}); err != nil {
		t.Fatalf("DisableMfa: %v", err)
	}
	assertOperatorMfaChangeNotices(t, env, operatorID,
		mfaflow.ChangeTotpEnabled, mfaflow.ChangeRecoveryCodesRegenerated, mfaflow.ChangeTotpDisabled)
}

// The first factor added to finish a sign-in that stopped at enrollment is
// the operator's own doing, so it queues no notice.
func TestDBOperatorMfaEnrollChallengeQueuesNoNotice(t *testing.T) {
	t.Parallel()

	env := newOperatorMfaEnv(t)
	requireOperatorMfa(t, env.pg)

	login := env.login(t, env.operator)
	if login.MfaChallenge.GetKind() != publirasplatformv1.MfaChallengeKind_MFA_CHALLENGE_KIND_ENROLL {
		t.Fatalf("mfa challenge = %v, want an ENROLL challenge", login.MfaChallenge)
	}
	started, err := env.auth.StartMfaEnrollment(context.Background(), &publirasplatformv1.PlatformAuthServiceStartMfaEnrollmentRequest{ChallengeToken: login.MfaChallenge.Token})
	if err != nil {
		t.Fatalf("StartMfaEnrollment with an enroll challenge: %v", err)
	}
	if _, err := env.auth.ConfirmMfaEnrollment(context.Background(), &publirasplatformv1.PlatformAuthServiceConfirmMfaEnrollmentRequest{
		ChallengeToken: login.MfaChallenge.Token,
		Code:           operatorMfaCode(t, started.Secret, 0),
	}); err != nil {
		t.Fatalf("ConfirmMfaEnrollment with an enroll challenge: %v", err)
	}
	assertOperatorMfaChangeNotices(t, env, env.operator.ID)
}
