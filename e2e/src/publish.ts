import { expect } from "@playwright/test";

import { querySql, runSql } from "./db";

/**
 * Advance a scheduled episode so the ticker.publish_episodes job can pick it up
 * without waiting for the minute-granularity `datetime-local` value.
 * The listing stays `scheduled`; only `scheduled_at` moves into the past.
 */
export const nudgeScheduledEpisodeReady = (episodePublicId: string): void => {
  // public_id is Base58 from the server — safe for a single-quoted literal.
  runSql(`
    UPDATE episode_listings el
    SET scheduled_at = NOW() - INTERVAL '5 seconds'
    FROM episodes e
    WHERE e.id = el.episode_id
      AND e.public_id = '${episodePublicId}'
      AND el.status = 'scheduled';
  `);
};

/**
 * Wait until the ticker.publish_episodes job has promoted the listing.
 * Poll via SQL (not web-host): a premature host request would cache the 404
 * under `"use cache"` and keep failing after the worker succeeds.
 */
export const waitUntilEpisodePublishedInDb = async (
  episodePublicId: string
): Promise<void> => {
  await expect
    .poll(
      () =>
        querySql(`
          SELECT el.status
          FROM episodes e
          JOIN episode_listings el ON el.episode_id = e.id
          WHERE e.public_id = '${episodePublicId}'
          LIMIT 1
        `),
      {
        message: `episode ${episodePublicId} was not published by the worker`,
        timeout: 30_000,
      }
    )
    .toBe("published");
};
