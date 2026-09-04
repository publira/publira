/**
 * Records created by `db/seeds/scenarios/090_email_change.sql`.
 *
 * The suite moves this member's account to another address and signs in with
 * it, so it owns an account no other spec authenticates as. Re-applying the
 * scenario is what puts the original address back.
 */

export const EMAIL_CHANGE_SCENARIO = "090_email_change";

/** Member of the dev seed tenant. Password hash is the same as `memberpass`. */
export const EMAIL_CHANGE_MEMBER = {
  email: "email-change-member@example.com",
  name: "Email Change E2E Member",
  password: "memberpass",
  publicId: "EchgMMBRAAA1",
} as const;

/** The address the account is moved to, and signs in with afterwards. */
export const EMAIL_CHANGE_NEW_EMAIL = "email-change-member-new@example.com";

/**
 * The address of a request whose token is expired before its link is opened.
 * The expired link is read from the message sent here, so it never has to be
 * told apart from the round trip's own mail.
 */
export const EMAIL_CHANGE_EXPIRED_EMAIL =
  "email-change-member-expired@example.com";
