import {
  createRequestRateLimiter,
  RATE_LIMIT_WINDOW_SECONDS,
} from "./request-rate-limit";
import type { RequestRateLimiterOptions } from "./request-rate-limit";

/**
 * What the edge admits from one client on the search page: 20 at once, and 2
 * a second after that (**Request rates** in `infra/proxy/README.md`).
 */
export const EDGE_SEARCH_PAGE_RATE = { burst: 20, perSecond: 2 } as const;

/**
 * How many requests for the search page one client may send in a window:
 * twice what the edge admits in one, the headroom `publira server` keeps over
 * the edge on the search procedures, so that a reader behind a working edge is
 * refused by the edge first.
 */
export const SEARCH_PAGE_LIMIT =
  2 *
  (EDGE_SEARCH_PAGE_RATE.burst +
    EDGE_SEARCH_PAGE_RATE.perSecond * RATE_LIMIT_WINDOW_SECONDS);

/**
 * Counts requests for the search page per client.
 *
 * `publira server` cannot count them: the page runs the search from this
 * process, as itself, for every reader at once.
 */
export const createSearchPageLimiter = (
  options: Pick<RequestRateLimiterOptions, "now" | "shared"> = {}
) =>
  createRequestRateLimiter({
    ...options,
    limit: SEARCH_PAGE_LIMIT,
    name: "search-page",
  });
