/**
 * Records created by `db/seeds/scenarios/190_age_verification.sql`.
 *
 * `tenant_config.age_verification` is one setting for a whole tenant, so the
 * suite that turns it on runs on a tenant of its own: on the development seed
 * tenant it would take away the body `host.age-rating.spec.ts` opens behind the
 * browser's own confirmation.
 */

export const AGE_VERIFICATION_SCENARIO = "190_age_verification";

export const AGE_VERIFICATION_TENANT = {
  /**
   * The tenant's uuid, not its `public_id`: web-host's cache tags are built
   * from the routing id, and the console suite drops them after writing the
   * rule back behind the app.
   */
  id: "018f0fa0-0001-7000-8000-000000000001",
  name: "Age Verification Tenant",
  publicId: "AverTNNTAAA1",
} as const;

/**
 * Tenant admin of that tenant, who picks the rule in the settings console.
 * Password hash is the same as `adminpass`.
 */
export const AGE_VERIFICATION_ADMIN = {
  email: "age-admin@example.com",
  name: "Age E2E Admin",
  password: "adminpass",
  publicId: "AverADMNAAA1",
} as const;

/** The rated series and its one free episode, which the rule still withholds. */
export const AGE_VERIFICATION_EPISODE = {
  publicId: "AverEPSDAAA1",
  seriesPublicId: "AverSERSAAA1",
  seriesTitle: "Age Verification Series 001",
  title: "Age Verification Episode 001-01",
} as const;

/** Old enough for `r18`. Password hash is `memberpass`. */
export const AGE_VERIFICATION_ADULT = {
  email: "age-adult@example.com",
  name: "Age E2E Adult",
  password: "memberpass",
  publicId: "AverMMBRAAA1",
} as const;

/** Sixteen: past `r15`, short of `r18`, and unable to change either. */
export const AGE_VERIFICATION_MINOR = {
  email: "age-minor@example.com",
  name: "Age E2E Minor",
  password: "memberpass",
  publicId: "AverMMBRAAA2",
} as const;

/** No date on file, which is the reader the settings screen exists for. */
export const AGE_VERIFICATION_UNDECLARED = {
  email: "age-undeclared@example.com",
  name: "Age E2E Undeclared",
  password: "memberpass",
  publicId: "AverMMBRAAA3",
} as const;

export const AGE_VERIFICATION_SERIES_PATH = `/series/${AGE_VERIFICATION_EPISODE.seriesPublicId}`;

export const AGE_VERIFICATION_EPISODE_PATH = `${AGE_VERIFICATION_SERIES_PATH}/episodes/${AGE_VERIFICATION_EPISODE.publicId}`;
