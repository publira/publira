import { WEB_HOST_INTERNAL_URL, WEB_PLATFORM_INTERNAL_URL } from "./urls";

const revalidateTags = async (
  app: string,
  internalUrl: string,
  tags: readonly string[]
): Promise<void> => {
  const token = process.env.PUBLIRA_REVALIDATE_TOKEN?.trim();
  if (!token) {
    throw new Error(
      `PUBLIRA_REVALIDATE_TOKEN is required to drop ${app} cache tags (set by e2e scripts)`
    );
  }

  const response = await fetch(`${internalUrl}/api/v1/revalidate`, {
    body: JSON.stringify({ tags }),
    headers: {
      "content-type": "application/json",
      "x-revalidate-token": token,
    },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(
      `revalidating ${app} tags failed: ${response.status} ${await response.text()}`
    );
  }
};

/**
 * Drop web-host cache tags the way the Go servers do after a write.
 *
 * A spec that changes data through the console or the site needs none of this:
 * the API revalidates the tags its own write touched. A spec that reaches past
 * the app and writes to Postgres directly — a scenario seed that empties a
 * table, or a state no screen produces — leaves web-host holding a
 * `"use cache"` entry nothing invalidated, so it has to send the same request
 * the servers send.
 *
 * Revalidation marks an entry stale rather than dropping it, so the request
 * right after this one may still be answered from the old copy. Poll by
 * navigating again rather than asserting on a single load.
 */
export const revalidateHostTags = (tags: readonly string[]): Promise<void> =>
  revalidateTags("web-host", WEB_HOST_INTERNAL_URL, tags);

/**
 * Drop web-platform cache tags after a spec wrote a platform-wide row straight
 * to Postgres, for the reason {@link revalidateHostTags} gives: the Platform
 * Console reads those rows through `"use cache"`, one entry for every
 * operator, so an entry filled earlier in the run outlives the write. The
 * same stale-while-revalidate caveat applies.
 */
export const revalidatePlatformTags = (
  tags: readonly string[]
): Promise<void> =>
  revalidateTags("web-platform", WEB_PLATFORM_INTERNAL_URL, tags);

/** The tag web-platform holds the SMTP settings under. */
export const platformEmailSettingsTag = "platform:email-settings";

/** The tag web-platform holds the search settings under. */
export const platformSearchSettingsTag = "platform:search-settings";

/** The tag web-platform holds the storage settings under. */
export const platformStorageSettingsTag = "platform:storage-settings";

/** The tag web-platform holds the general settings (locale, zone) under. */
export const platformSettingsTag = "platform:settings";

/** The tag web-platform holds every operator read under. */
export const platformOperatorsTag = "platform:operators";

/** The tag web-platform holds every end-user read under. */
export const platformEndUsersTag = "platform:users";

/** The tag web-platform holds every tenant read under. */
export const platformTenantsTag = "platform:tenants";

/** The tag web-platform holds the dashboard's counts and recent events under. */
export const platformDashboardTag = "platform:dashboard";

/** The tag web-platform holds every audit log read under. */
export const platformAuditLogsTag = "platform:audit-logs";

/** The tag web-platform holds every operator's notifications under. */
export const platformNotificationsTag = "platform:notifications";

/**
 * The tag web-host holds the tenant's site chrome under. The comment mode
 * rides on that read, so a scenario seed that writes `tenant_config` directly
 * has to drop it.
 */
export const tenantSiteTag = (tenantId: string): string =>
  `tenant:${tenantId}:site`;

/** The tag web-host holds one episode's public comment list under. */
export const episodeCommentsTag = (
  tenantId: string,
  episodePublicId: string
): string => `tenant:${tenantId}:episode:${episodePublicId}:comments`;

/**
 * The tag every series and episode read of one tenant carries. The reader
 * headcount is part of the cached episode read, so a spec that writes
 * `episode_ratings` directly has to drop this tag and the one below.
 */
export const tenantSeriesDetailTag = (tenantId: string): string =>
  `tenant:${tenantId}:series:detail`;

/** The tag one series and its episodes carry on top of that one. */
export const tenantSeriesTag = (
  tenantId: string,
  seriesPublicId: string
): string => `tenant:${tenantId}:series:${seriesPublicId}`;
