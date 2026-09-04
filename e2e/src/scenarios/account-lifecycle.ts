/**
 * Records created by `db/seeds/scenarios/100_account_lifecycle.sql`.
 *
 * The suite signs up the two addresses below and resets the registered
 * member's password, so it owns every account it touches. Re-applying the
 * scenario is what puts the member's password back and removes the accounts
 * the sign-ups created.
 */

export const ACCOUNT_LIFECYCLE_SCENARIO = "100_account_lifecycle";

/**
 * The already-registered member of the dev seed tenant: the address a
 * duplicate sign-up reuses, and the account the password reset moves.
 * Password hash is the same as `memberpass`.
 */
export const ACCOUNT_LIFECYCLE_MEMBER = {
  email: "account-lifecycle-member@example.com",
  name: "Account Lifecycle E2E Member",
  password: "memberpass",
  publicId: "AlifMMBRAAA1",
} as const;

/** The password the reset round trip moves that member to. */
export const ACCOUNT_LIFECYCLE_RESET_PASSWORD = "resetmemberpass";

/**
 * The password a replay of the already-spent reset link submits. Nothing may
 * ever sign in with it: naming it separately is what makes "the second use set
 * no password" an assertion rather than an assumption.
 */
export const ACCOUNT_LIFECYCLE_REPLAY_PASSWORD = "replaymemberpass";

/** The address a run signs up with, confirms, and then signs in as. */
export const ACCOUNT_LIFECYCLE_SIGNUP = {
  email: "account-lifecycle-new@example.com",
  name: "Account Lifecycle E2E Signup",
  password: "signuppass",
} as const;

/**
 * A second sign-up, whose verification token is expired before its link is
 * opened. It is its own account so the expiry cannot reach the confirmation
 * the round trip above depends on.
 */
export const ACCOUNT_LIFECYCLE_EXPIRED_SIGNUP = {
  email: "account-lifecycle-expired@example.com",
  name: "Account Lifecycle E2E Expired Signup",
  password: "signuppass",
} as const;

/** An address the tenant has no account for, used for the reset request. */
export const ACCOUNT_LIFECYCLE_UNKNOWN_EMAIL =
  "account-lifecycle-unknown@example.com";
