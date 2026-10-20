package mfaflow

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/mfa"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

// fakeAccount keeps one account's second factor in memory. It stores the
// authenticator's secret as it is: the encryptor it hands out seals nothing.
type fakeAccount struct {
	totp          Totp
	totpFound     bool
	lastStep      int64
	failures      int
	lockedUntil   time.Time
	recoveryCodes map[uuid.UUID]string
	usedCodes     map[uuid.UUID]bool
	challengeUsed bool
	passkeysErr   error
	audits        []string
}

func newFakeAccount(t *testing.T) (*fakeAccount, string) {
	t.Helper()
	enrollment, err := mfa.GenerateEnrollment("Publira", "member@example.com")
	if err != nil {
		t.Fatalf("GenerateEnrollment: %v", err)
	}
	return &fakeAccount{
		totp:          Totp{SecretEncrypted: enrollment.Secret, EnabledAt: sql.NullTime{Time: time.Now(), Valid: true}},
		totpFound:     true,
		recoveryCodes: map[uuid.UUID]string{},
		usedCodes:     map[uuid.UUID]bool{},
	}, enrollment.Secret
}

func (a *fakeAccount) Queries(context.Context) dbmodels.Querier { return nil }
func (a *fakeAccount) InTx(_ context.Context, fn func(dbmodels.Querier) error) error {
	return fn(nil)
}
func (a *fakeAccount) Totp(context.Context, dbmodels.Querier) (Totp, bool, error) {
	return a.totp, a.totpFound, nil
}
func (a *fakeAccount) Passkeys(context.Context, dbmodels.Querier) (int64, error) {
	return 0, a.passkeysErr
}
func (a *fakeAccount) StoreTotpSecret(_ context.Context, _ dbmodels.Querier, encrypted string) error {
	a.totp, a.totpFound = Totp{SecretEncrypted: encrypted}, true
	return nil
}
func (a *fakeAccount) ClaimTotpStep(_ context.Context, _ dbmodels.Querier, step int64) (bool, error) {
	if step <= a.lastStep {
		return false, nil
	}
	a.lastStep = step
	return true, nil
}
func (a *fakeAccount) EnableTotp(context.Context, dbmodels.Querier) (bool, error) {
	if a.totp.EnabledAt.Valid {
		return false, nil
	}
	a.totp.EnabledAt = sql.NullTime{Time: time.Now(), Valid: true}
	return true, nil
}
func (a *fakeAccount) DeleteTotp(context.Context, dbmodels.Querier) error {
	a.totp, a.totpFound = Totp{}, false
	return nil
}
func (a *fakeAccount) Locked(context.Context, dbmodels.Querier) (bool, error) {
	return a.lockedUntil.After(time.Now()), nil
}
func (a *fakeAccount) CountFailure(context.Context, dbmodels.Querier) (bool, error) {
	a.failures++
	if a.failures >= mfa.MaxFailedAttempts {
		a.failures = 0
		a.lockedUntil = time.Now().Add(mfa.LockDuration)
	}
	return a.lockedUntil.After(time.Now()), nil
}
func (a *fakeAccount) ResetFailures(context.Context, dbmodels.Querier) error {
	a.failures, a.lockedUntil = 0, time.Time{}
	return nil
}
func (a *fakeAccount) UnusedRecoveryCodes(context.Context, dbmodels.Querier) ([]RecoveryCode, error) {
	var codes []RecoveryCode
	for id, hash := range a.recoveryCodes {
		if !a.usedCodes[id] {
			codes = append(codes, RecoveryCode{ID: id, CodeHash: hash})
		}
	}
	return codes, nil
}
func (a *fakeAccount) MarkRecoveryCodeUsed(_ context.Context, _ dbmodels.Querier, id uuid.UUID) (bool, error) {
	if a.usedCodes[id] {
		return false, nil
	}
	a.usedCodes[id] = true
	return true, nil
}
func (a *fakeAccount) CountUnusedRecoveryCodes(ctx context.Context, q dbmodels.Querier) (int64, error) {
	codes, err := a.UnusedRecoveryCodes(ctx, q)
	return int64(len(codes)), err
}
func (a *fakeAccount) DeleteRecoveryCodes(context.Context, dbmodels.Querier) error {
	a.recoveryCodes, a.usedCodes = map[uuid.UUID]string{}, map[uuid.UUID]bool{}
	return nil
}
func (a *fakeAccount) CreateRecoveryCode(_ context.Context, _ dbmodels.Querier, id uuid.UUID, hash string) error {
	a.recoveryCodes[id] = hash
	return nil
}
func (a *fakeAccount) ReleaseRecoveryCodes(ctx context.Context, q dbmodels.Querier) error {
	return a.DeleteRecoveryCodes(ctx, q)
}
func (a *fakeAccount) FromChallenge() bool { return true }
func (a *fakeAccount) ClaimChallenge(context.Context, dbmodels.Querier) (bool, error) {
	if a.challengeUsed {
		return false, nil
	}
	a.challengeUsed = true
	return true, nil
}
func (a *fakeAccount) CanIssueSession() bool { return true }
func (a *fakeAccount) IssueSession(context.Context) (*publirattypesv1.User, *publirattypesv1.AccessToken, error) {
	return &publirattypesv1.User{}, &publirattypesv1.AccessToken{Token: "session"}, nil
}
func (a *fakeAccount) Encryptor() Encryptor { return plainEncryptor{} }
func (a *fakeAccount) OTPAuthLabel() (string, string) {
	return "Publira", "member@example.com"
}
func (a *fakeAccount) Actions() Actions {
	return Actions{Enrolled: "enrolled", Verified: "verified", RecoveryCodeUsed: "recovery_code_used", Disabled: "disabled", RecoveryCodesRegenerated: "regenerated"}
}
func (a *fakeAccount) Audit(_ context.Context, action, outcome, reason string) {
	a.audits = append(a.audits, action+"/"+outcome+"/"+reason)
}
func (a *fakeAccount) LogVerification(context.Context, string, string) {}
func (a *fakeAccount) InternalError(_ context.Context, msg string, err error) error {
	return connect.NewError(connect.CodeInternal, msg).WithCause(err)
}

type plainEncryptor struct{}

func (plainEncryptor) EncryptString(plaintext string) (string, error) { return plaintext, nil }
func (plainEncryptor) DecryptString(value string) (string, error)     { return value, nil }

func currentCode(t *testing.T, secret string) string {
	t.Helper()
	code, err := mfa.GenerateCode(secret, time.Now())
	if err != nil {
		t.Fatalf("GenerateCode: %v", err)
	}
	return code
}

func TestCheckCodeAcceptsACodeOnce(t *testing.T) {
	acct, secret := newFakeAccount(t)
	code := currentCode(t, secret)

	if _, err := CheckCode(context.Background(), acct, &acct.totp, code, false); err != nil {
		t.Fatalf("CheckCode with a current code: %v", err)
	}
	outcome, err := CheckCode(context.Background(), acct, &acct.totp, code, false)
	if connect.CodeOf(err) != connect.CodeUnauthenticated || outcome.Reason != "code_reused" {
		t.Fatalf("CheckCode with the same code again = %v, %q; want unauthenticated, code_reused", err, outcome.Reason)
	}
}

func TestCheckCodeLocksOnTheAttemptThatReachesTheLimit(t *testing.T) {
	acct, secret := newFakeAccount(t)

	var outcome Outcome
	var err error
	for range mfa.MaxFailedAttempts {
		outcome, err = CheckCode(context.Background(), acct, &acct.totp, "000000", false)
	}
	if connect.CodeOf(err) != connect.CodeResourceExhausted || outcome.Reason != "locked" {
		t.Fatalf("attempt %d = %v, %q; want resource_exhausted, locked", mfa.MaxFailedAttempts, err, outcome.Reason)
	}
	// The lock holds against a right code as well.
	if _, err := CheckCode(context.Background(), acct, &acct.totp, currentCode(t, secret), false); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("a right code while locked = %v, want resource_exhausted", err)
	}
}

func TestCheckCodeSpendsARecoveryCodeOnlyWhereAllowed(t *testing.T) {
	acct, _ := newFakeAccount(t)
	codes, err := ReplaceRecoveryCodes(context.Background(), acct, nil)
	if err != nil {
		t.Fatalf("ReplaceRecoveryCodes: %v", err)
	}

	if _, err := CheckCode(context.Background(), acct, &acct.totp, codes[0], false); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("a recovery code where none is allowed = %v, want unauthenticated", err)
	}
	outcome, err := CheckCode(context.Background(), acct, &acct.totp, codes[0], true)
	if err != nil || !outcome.RecoveryUsed {
		t.Fatalf("a recovery code where one is allowed = %v, recovery used %v; want accepted", err, outcome.RecoveryUsed)
	}
	if _, err := CheckCode(context.Background(), acct, &acct.totp, codes[0], true); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("a spent recovery code = %v, want unauthenticated", err)
	}
	if remaining, _ := RemainingRecoveryCodes(context.Background(), acct); remaining != mfa.RecoveryCodeCount-1 {
		t.Fatalf("remaining recovery codes = %d, want %d", remaining, mfa.RecoveryCodeCount-1)
	}
}

func TestCompleteVerificationBuysOneSessionPerChallenge(t *testing.T) {
	acct, _ := newFakeAccount(t)

	if _, err := CompleteVerification(context.Background(), acct, FactorTotp); err != nil {
		t.Fatalf("CompleteVerification: %v", err)
	}
	if _, err := CompleteVerification(context.Background(), acct, FactorTotp); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("CompleteVerification with a spent challenge = %v, want unauthenticated", err)
	}
	want := []string{"verified/success/totp", "verified/failure/challenge_spent"}
	if len(acct.audits) != len(want) || acct.audits[0] != want[0] || acct.audits[1] != want[1] {
		t.Fatalf("audit entries = %v, want %v", acct.audits, want)
	}
}

func TestDisableReleasesTheRecoveryCodes(t *testing.T) {
	acct, _ := newFakeAccount(t)
	codes, err := ReplaceRecoveryCodes(context.Background(), acct, nil)
	if err != nil {
		t.Fatalf("ReplaceRecoveryCodes: %v", err)
	}

	if err := Disable(context.Background(), acct, codes[0]); err != nil {
		t.Fatalf("Disable with a recovery code: %v", err)
	}
	if acct.totpFound || len(acct.recoveryCodes) != 0 {
		t.Fatalf("after Disable: authenticator found %v, %d recovery codes; want neither", acct.totpFound, len(acct.recoveryCodes))
	}
	if err := Disable(context.Background(), acct, codes[1]); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("Disable without an authenticator = %v, want failed_precondition", err)
	}
}

// A failure to read the factors reaches the client as the generic internal
// error, never as the database's own.
func TestFactorsOfAnswersAFailedPasskeyCountAsInternal(t *testing.T) {
	acct, _ := newFakeAccount(t)
	acct.passkeysErr = errors.New("driver: connection reset")

	_, err := FactorsOf(context.Background(), acct, nil)
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("FactorsOf with a failed passkey count = %v, want internal", err)
	}
}
