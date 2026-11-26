package adminapi

import (
	"context"
	"encoding/json"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/mfaflow"
	"github.com/publira/publira/server/internal/outbox"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/tenantwebauthn/webauthntest"
	"github.com/publira/publira/server/internal/testutil"
)

// mfaChangeNotices lists, oldest first, the changes the second factor notices
// queued for the tenant's admin name, checking that each one is addressed to
// that account.
func mfaChangeNotices(t *testing.T, env *adminDBEnv, tenant adminDBTenant) []mfaflow.Change {
	t.Helper()

	var changes []mfaflow.Change
	for _, event := range env.pendingOutboxEvents(t, outbox.EventTypeAdminMfaChangedNoticeEmail) {
		var payload outbox.AdminMfaChangedNoticeEmailPayload
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			t.Fatalf("decode %s payload: %v", event.EventType, err)
		}
		if !event.TenantID.Valid || event.TenantID.UUID != tenant.Tenant.ID || payload.TenantID != tenant.Tenant.ID.String() {
			t.Fatalf("notice tenant = %v / %q, want %s", event.TenantID, payload.TenantID, tenant.Tenant.ID)
		}
		if payload.UserID != tenant.User.ID.String() {
			t.Fatalf("notice user = %q, want %s", payload.UserID, tenant.User.ID)
		}
		if _, err := time.Parse(time.RFC3339Nano, payload.ChangedAt); err != nil {
			t.Fatalf("notice changed_at = %q: %v", payload.ChangedAt, err)
		}
		changes = append(changes, mfaflow.Change(payload.Change))
	}
	return changes
}

func assertMfaChangeNotices(t *testing.T, env *adminDBEnv, tenant adminDBTenant, want ...mfaflow.Change) {
	t.Helper()

	if got := mfaChangeNotices(t, env, tenant); !slices.Equal(got, want) {
		t.Fatalf("queued notices = %v, want %v", got, want)
	}
}

// Every change a signed-in account makes to its second factors queues one
// notice of it, in the order they were made.
func TestAdminMfaChangesEachQueueOneNotice(t *testing.T) {
	env := newPasskeyDBEnv(t)
	tenant := seedMfaTenant(t, env)
	ctx := testutil.WithBearer(context.Background(), tenant.token())
	want := []mfaflow.Change{}

	secret, _ := enrollMfa(t, env, tenant)
	want = append(want, mfaflow.ChangeTotpEnabled)
	assertMfaChangeNotices(t, env, tenant, want...)

	byCode, err := env.authClient().RegenerateMfaRecoveryCodes(ctx, &publiraadminv1.AdminAuthServiceRegenerateMfaRecoveryCodesRequest{
		Tenant: tenant.tenantContext(),
		Code:   mfaNextCode(t, secret),
	})
	if err != nil {
		t.Fatalf("RegenerateMfaRecoveryCodes: %v", err)
	}
	want = append(want, mfaflow.ChangeRecoveryCodesRegenerated)
	assertMfaChangeNotices(t, env, tenant, want...)

	authenticator, registered := addPasskey(t, env, tenant, "Laptop", codeConfirmation(byCode.RecoveryCodes[0]))
	want = append(want, mfaflow.ChangePasskeyRegistered)
	assertMfaChangeNotices(t, env, tenant, want...)

	regenerated, err := regenerateWithPasskey(env, tenant, authenticator.Assert(t, beginPasskeyConfirmation(t, env, tenant)))
	if err != nil {
		t.Fatalf("RegenerateMfaRecoveryCodes with a passkey: %v", err)
	}
	want = append(want, mfaflow.ChangeRecoveryCodesRegenerated)
	assertMfaChangeNotices(t, env, tenant, want...)

	if _, err := env.authClient().DeletePasskey(ctx, &publiraadminv1.AdminAuthServiceDeletePasskeyRequest{
		Tenant:       tenant.tenantContext(),
		Id:           registered.Passkey.Id,
		Confirmation: codeConfirmation(regenerated.RecoveryCodes[0]),
	}); err != nil {
		t.Fatalf("DeletePasskey: %v", err)
	}
	want = append(want, mfaflow.ChangePasskeyRemoved)
	assertMfaChangeNotices(t, env, tenant, want...)

	if _, err := env.authClient().DisableMfa(ctx, &publiraadminv1.AdminAuthServiceDisableMfaRequest{
		Tenant: tenant.tenantContext(),
		Code:   regenerated.RecoveryCodes[1],
	}); err != nil {
		t.Fatalf("DisableMfa: %v", err)
	}
	want = append(want, mfaflow.ChangeTotpDisabled)
	assertMfaChangeNotices(t, env, tenant, want...)
}

// A change the server refuses leaves nothing to announce.
func TestAdminMfaRefusedChangesQueueNoNotice(t *testing.T) {
	env := newPasskeyDBEnv(t)
	tenant := seedMfaTenant(t, env)
	ctx := testutil.WithBearer(context.Background(), tenant.token())

	started, err := env.authClient().StartMfaEnrollment(ctx, &publiraadminv1.AdminAuthServiceStartMfaEnrollmentRequest{
		Tenant: tenant.tenantContext(),
	})
	if err != nil {
		t.Fatalf("StartMfaEnrollment: %v", err)
	}
	if _, err := env.authClient().ConfirmMfaEnrollment(ctx, &publiraadminv1.AdminAuthServiceConfirmMfaEnrollmentRequest{
		Tenant: tenant.tenantContext(),
		Code:   "000000",
	}); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("ConfirmMfaEnrollment with a wrong code = %v, want unauthenticated", err)
	}
	assertMfaChangeNotices(t, env, tenant)

	confirmed, err := env.authClient().ConfirmMfaEnrollment(ctx, &publiraadminv1.AdminAuthServiceConfirmMfaEnrollmentRequest{
		Tenant: tenant.tenantContext(),
		Code:   mfaCode(t, started.Secret),
	})
	if err != nil {
		t.Fatalf("ConfirmMfaEnrollment: %v", err)
	}
	codes := confirmed.RecoveryCodes
	if err := finishSecondPasskey(t, env, tenant, nil); err == nil {
		t.Fatal("FinishPasskeyRegistration added a passkey beside the authenticator without a confirmation")
	}
	authenticator, registered := addPasskey(t, env, tenant, "", codeConfirmation(codes[0]))
	before := mfaChangeNotices(t, env, tenant)

	if _, err := env.authClient().RegenerateMfaRecoveryCodes(ctx, &publiraadminv1.AdminAuthServiceRegenerateMfaRecoveryCodesRequest{
		Tenant: tenant.tenantContext(),
		Code:   "000000",
	}); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("RegenerateMfaRecoveryCodes with a wrong code = %v, want unauthenticated", err)
	}
	authenticator.Origin = passkeyStorefrontOrigin
	_, err = regenerateWithPasskey(env, tenant, authenticator.Assert(t, beginPasskeyConfirmation(t, env, tenant)))
	assertPasskeyRefused(t, err, "RegenerateMfaRecoveryCodes with an assertion from the storefront's origin")
	if _, err := env.authClient().DisableMfa(ctx, &publiraadminv1.AdminAuthServiceDisableMfaRequest{
		Tenant: tenant.tenantContext(),
		Code:   "000000",
	}); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("DisableMfa with a wrong code = %v, want unauthenticated", err)
	}
	begun, err := env.authClient().BeginPasskeyRegistration(ctx, &publiraadminv1.AdminAuthServiceBeginPasskeyRegistrationRequest{
		Tenant: tenant.tenantContext(),
	})
	if err != nil {
		t.Fatalf("BeginPasskeyRegistration: %v", err)
	}
	_, err = env.authClient().FinishPasskeyRegistration(ctx, &publiraadminv1.AdminAuthServiceFinishPasskeyRegistrationRequest{
		Tenant:         tenant.tenantContext(),
		CredentialJson: webauthntest.New(t, passkeyStorefrontOrigin).Register(t, begun.CreationOptionsJson),
	})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("FinishPasskeyRegistration from the storefront's origin = %v, want invalid_argument", err)
	}

	// The tenant comes to require the factor while a passkey stands beside
	// the authenticator; taking the authenticator off is what makes the
	// passkey the last one. The server keeps the policy it read for
	// platformpolicy.CacheTTL, so it is set before the first removal asks
	// for it.
	requireTenantAdminMFA(t, env)
	if _, err := env.authClient().DeletePasskey(ctx, &publiraadminv1.AdminAuthServiceDeletePasskeyRequest{
		Tenant: tenant.tenantContext(),
		Id:     registered.Passkey.Id,
	}); err == nil {
		t.Fatal("DeletePasskey removed a passkey without a confirmation")
	}
	if _, err := env.authClient().DisableMfa(ctx, &publiraadminv1.AdminAuthServiceDisableMfaRequest{
		Tenant: tenant.tenantContext(),
		Code:   codes[1],
	}); err != nil {
		t.Fatalf("DisableMfa: %v", err)
	}
	before = append(before, mfaflow.ChangeTotpDisabled)
	authenticator.Origin = passkeyConsoleOrigin
	if _, err := env.authClient().DeletePasskey(ctx, &publiraadminv1.AdminAuthServiceDeletePasskeyRequest{
		Tenant:       tenant.tenantContext(),
		Id:           registered.Passkey.Id,
		Confirmation: passkeyConfirmation(t, env, tenant, authenticator),
	}); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("DeletePasskey of the last required factor = %v, want failed_precondition", err)
	}
	assertMfaChangeNotices(t, env, tenant, before...)
}

// The first factor added to finish a sign-in that stopped at enrollment is
// the owner's own doing, so neither an authenticator nor a passkey added that
// way queues a notice.
func TestAdminMfaEnrollChallengeQueuesNoNotice(t *testing.T) {
	t.Run("authenticator app", func(t *testing.T) {
		env := newPasskeyDBEnv(t)
		requireTenantAdminMFA(t, env)
		tenant := seedMfaTenant(t, env)

		login := mfaLogin(t, env, tenant)
		started, err := env.authClient().StartMfaEnrollment(context.Background(), &publiraadminv1.AdminAuthServiceStartMfaEnrollmentRequest{
			Tenant:         tenant.tenantContext(),
			ChallengeToken: login.MfaChallenge.Token,
		})
		if err != nil {
			t.Fatalf("StartMfaEnrollment with an enroll challenge: %v", err)
		}
		if _, err := env.authClient().ConfirmMfaEnrollment(context.Background(), &publiraadminv1.AdminAuthServiceConfirmMfaEnrollmentRequest{
			Tenant:         tenant.tenantContext(),
			ChallengeToken: login.MfaChallenge.Token,
			Code:           mfaCode(t, started.Secret),
		}); err != nil {
			t.Fatalf("ConfirmMfaEnrollment with an enroll challenge: %v", err)
		}
		assertMfaChangeNotices(t, env, tenant)
	})

	t.Run("passkey", func(t *testing.T) {
		env := newPasskeyDBEnv(t)
		requireTenantAdminMFA(t, env)
		tenant := seedMfaTenant(t, env)

		login := mfaLogin(t, env, tenant)
		begun, err := env.authClient().BeginPasskeyRegistration(context.Background(), &publiraadminv1.AdminAuthServiceBeginPasskeyRegistrationRequest{
			Tenant:         tenant.tenantContext(),
			ChallengeToken: login.MfaChallenge.Token,
		})
		if err != nil {
			t.Fatalf("BeginPasskeyRegistration with an enroll challenge: %v", err)
		}
		if _, err := env.authClient().FinishPasskeyRegistration(context.Background(), &publiraadminv1.AdminAuthServiceFinishPasskeyRegistrationRequest{
			Tenant:         tenant.tenantContext(),
			ChallengeToken: login.MfaChallenge.Token,
			CredentialJson: webauthntest.New(t, passkeyConsoleOrigin).Register(t, begun.CreationOptionsJson),
		}); err != nil {
			t.Fatalf("FinishPasskeyRegistration with an enroll challenge: %v", err)
		}
		assertMfaChangeNotices(t, env, tenant)
	})
}
