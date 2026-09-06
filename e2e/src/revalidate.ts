import { WEB_HOST_INTERNAL_URL } from "./urls";

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
export const revalidateHostTags = async (
  tags: readonly string[]
): Promise<void> => {
  const token = process.env.PUBLIRA_REVALIDATE_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "PUBLIRA_REVALIDATE_TOKEN is required to drop web-host cache tags (set by e2e scripts)"
    );
  }

  const response = await fetch(`${WEB_HOST_INTERNAL_URL}/api/v1/revalidate`, {
    body: JSON.stringify({ tags }),
    headers: {
      "content-type": "application/json",
      "x-revalidate-token": token,
    },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(
      `revalidating web-host tags failed: ${response.status} ${await response.text()}`
    );
  }
};

/** The tag web-host holds one episode's public comment list under. */
export const episodeCommentsTag = (
  tenantId: string,
  episodePublicId: string
): string => `tenant:${tenantId}:episode:${episodePublicId}:comments`;
