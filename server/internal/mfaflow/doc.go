// Package mfaflow is the second-factor flow the tenant consoles and the
// Platform Console share: deciding what a correct password still leaves owed,
// enrolling and confirming an authenticator, settling a sign-in with a code or
// a recovery code, counting failures toward the lock, spending the challenge a
// password earned, taking the factor off, and replacing the recovery codes.
//
// The flow is written once over [Account], which each API implements for its
// own principal: tenant staff over users and audit_logs, operators over
// platform_users and platform_audit_logs. The two keep separate tables,
// database roles, and row-level security on purpose, so an Account is what
// the flow reaches them through rather than a schema they share. What one side
// has and the other does not — the tenant's passkeys and per-role
// requirement, the operator policy — stays in that side's API and meets the
// flow only where an Account method names it.
//
// The codes and the arithmetic behind them are [mfa]'s; this package is what
// is done with them, in the order the RPCs do it.
//
// # The challenge that stands in for half a session
//
// A correct password does not earn a session while [OwedAfterPassword] says
// something is owed. The login answers a challenge token instead, under an
// audience of its own: verify for an account that holds a confirmed
// authenticator or a passkey, naming them in methods, and enroll for one that
// holds neither where the factor is required of it. A challenge lives
// [auth.MFAChallengeTTL] and carries the credentials version, so a password
// change ends a pending one.
//
// A challenge buys one session, claimed by its jti in the used-challenges
// table of its side; mfachallenges deletes those rows once their token has
// expired. Verifying exchanges a verify challenge and a code, or on the tenant
// side a passkey assertion, for the session. An enroll challenge is presented
// twice by design, to [StartEnrollment] and then to [ConfirmEnrollment], which
// claims it in the transaction that enables the factor and answers the
// recovery codes and the session together, finishing a login that was stopped
// at enrollment. A second confirmation with the same token is refused as an
// invalid session, even after the factor has been turned off again; of two
// confirmations racing on one enrollment, the one that loses is refused with
// "mfa is already enabled" and writes no recovery codes. An enroll challenge is
// also refused once the account holds a factor, whichever login enrolled it,
// so a second login cannot enroll a factor of its own past the owner's.
//
// # Proving the account again
//
// Taking the authenticator off takes a code from it or a recovery code.
// Replacing the recovery codes takes the authenticator, or on the tenant side a
// passkey, and never a recovery code. [mfa.MaxFailedAttempts] refused codes or
// passkey assertions lock the account for [mfa.LockDuration], counted per
// account across signing in, disabling, and regenerating alike. The recovery
// codes go when the account's last factor does.
//
// # The two sides
//
// For tenant staff, mfa_required_for_tenant_admin in the platform policy
// requires the factor of tenant_admin alone; an editor or an auditor may
// enroll and is never held back for not having. Passkeys are the tenant side's
// alone, in the admin API over tenantwebauthn. Removing one needs the session
// alone, and is refused with failed_precondition when it is the account's last
// factor and the policy requires one of its role. A passkey registered for an
// RP ID the console no longer derives, after its host has moved, is neither a
// factor nor listed, and the account's recovery codes stay while one is
// stored, since moving the console back makes it a factor again.
//
// For operators of the Platform Console, the factor lives in the
// platform_user_mfa_* tables, which publira_platform alone reaches apart from
// the purge. Their challenges name no tenant, and neither console accepts the
// other's. mfa_required_for_platform_operator requires the factor of every
// operator role, platform_auditor included, and the platform API refuses to
// switch it on without a secret manager, where no operator could enroll.
package mfaflow
