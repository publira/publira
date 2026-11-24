import { createRequestRateLimiter } from "./request-rate-limit";
import type { RequestRateLimiterOptions } from "./request-rate-limit";

/**
 * How many view beacons one client may send in a window.
 *
 * A detail page sends one when it is opened, so a reader sends one per page
 * and a pause to look at it; 30 in 10 seconds is several readers behind one
 * address paging through a catalog at once. Every beacon a signed-out reader
 * sends without the actor cookie files a new viewer, so this is also how many
 * viewers one address can add in a window. A refused beacon loses that view
 * and nothing else: the page it came from has already rendered and never
 * reads the answer.
 */
export const VIEW_BEACON_LIMIT = 30;

/**
 * Counts view beacons per client.
 *
 * The edge does not limit the path. `publira server` charges the call behind
 * it to the reader's public API allowance, which is sized for reading a
 * catalog rather than for filing viewers, so the beacon has a tighter
 * allowance of its own here.
 */
export const createViewBeaconLimiter = (
  options: Pick<RequestRateLimiterOptions, "now" | "shared"> = {}
) =>
  createRequestRateLimiter({
    ...options,
    limit: VIEW_BEACON_LIMIT,
    name: "view-beacon",
  });
