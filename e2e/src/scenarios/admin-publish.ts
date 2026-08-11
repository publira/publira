import "temporal-polyfill/global";

/**
 * Constants for the admin publish-flow E2E (#516).
 *
 * Credentials match `db/seeds/README.md` / `db/seeds/dev/001_tenant_users.sql`.
 * Label / creator public_ids match `db/seeds/dev/010_catalog.sql`.
 */

/** Dev seed tenant admin (Host `admin.localhost`). */
export const SEED_ADMIN = {
  email: "admin@example.com",
  password: "adminpass",
} as const;

/** Existing catalog rows the series form can attach without creating them. */
export const SEED_CATALOG = {
  creatorName: "Seed Author 001",
  creatorPublicId: "SeedAUTHAAA1",
  labelName: "Seed Label 01",
  labelPublicId: "SeedLABLAAA1",
} as const;

const ADMIN_UI_TIME_ZONE = "Asia/Tokyo";

const padTwo = (value: number): string => String(value).padStart(2, "0");

/**
 * `datetime-local` wall clock in Asia/Tokyo (admin UI display zone).
 */
export const toTokyoDateTimeLocal = (instant: Temporal.Instant): string => {
  const zoned = instant.toZonedDateTimeISO(ADMIN_UI_TIME_ZONE);
  return `${zoned.year}-${padTwo(zoned.month)}-${padTwo(zoned.day)}T${padTwo(zoned.hour)}:${padTwo(zoned.minute)}`;
};

/** Wall clock one hour in the past — publishes a series immediately. */
export const publishedAtOneHourAgo = (): Temporal.Instant =>
  Temporal.Now.instant().subtract({ hours: 1 });

/** Wall clock 90 seconds ahead — schedules an episode (minute precision). */
export const scheduleAtNinetySecondsFromNow = (): Temporal.Instant =>
  Temporal.Now.instant().add({ seconds: 90 });

/** Unique run suffix so re-runs do not collide with leftover titles. */
export const uniqueSuffix = (): string =>
  crypto.randomUUID().replaceAll("-", "").slice(0, 12);
