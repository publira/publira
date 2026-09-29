/**
 * Which of its ratings the tenant makes a reader prove an age for. The stored
 * `tenant_config.age_verification` values rather than the generated enum, so
 * the settings card, the `FormData` it submits, and the catalog keys naming
 * each option are all the same three strings.
 *
 * Kept apart from `tenant-age-verification.ts` because the settings card is a
 * Client Component: importing the value from the module that reads the session
 * would pull `next/headers` into the browser graph.
 */
export type TenantAgeVerification = "none" | "r15_and_r18" | "r18";

/** The rungs of one ladder, from proving nothing to proving both ratings. */
export const TENANT_AGE_VERIFICATIONS = [
  "none",
  "r18",
  "r15_and_r18",
] as const satisfies readonly TenantAgeVerification[];

export const isTenantAgeVerification = (
  value: string
): value is TenantAgeVerification =>
  TENANT_AGE_VERIFICATIONS.some((rule) => rule === value);
