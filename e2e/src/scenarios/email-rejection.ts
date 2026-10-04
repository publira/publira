/**
 * Records created by `db/seeds/scenarios/380_email_rejection.sql`. Re-applying
 * the file deletes the tenant and writes it again, which takes the setting the
 * suite saves and the accounts its sign-ups create.
 */

export const EMAIL_REJECTION_SCENARIO = "380_email_rejection";

export const EMAIL_REJECTION_TENANT = "RjctTNNTAAA1";

/**
 * Tenant admin, who edits the setting. Password hash is the same as
 * `adminpass`.
 */
export const EMAIL_REJECTION_ADMIN = {
  email: "reject-admin@example.com",
  name: "Email Rejection E2E Admin",
  password: "adminpass",
  publicId: "RjctADMNAAA1",
} as const;

/**
 * Tenant editor, to whom the API does not answer the setting. Password hash is
 * the same as `adminpass`.
 */
export const EMAIL_REJECTION_EDITOR = {
  email: "reject-editor@example.com",
  name: "Email Rejection E2E Editor",
  password: "adminpass",
  publicId: "RjctEDTRAAA1",
} as const;

/** The name and password every sign-up of the suite types. */
export const EMAIL_REJECTION_READER = {
  name: "Email Rejection E2E Reader",
  password: "reject-password",
} as const;
