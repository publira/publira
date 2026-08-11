const defaultPageSize = 100;
const defaultMaxRows = 10_000;
const defaultMaxPages = 100;

export interface CursorPageOptions {
  maxPages?: number;
  maxRows?: number;
  pageSize?: number;
}

/** Options for {@link findByPublicIdWithToken}. Same shape as {@link CursorPageOptions}. */
export type PublicIdLookupOptions = CursorPageOptions;

export type FetchCursorPage<T> = (
  token: string,
  limit: number
) => Promise<{ items: readonly T[]; nextToken: string }>;

/** `false` stops the walk; any other value continues while budget remains. */
export type CursorPageVisitResult = boolean | undefined;

/**
 * Visit each page of a cursor-paginated list RPC in order.
 *
 * Pages are sequential because each request depends on the token from the
 * previous response. Repeated tokens plus page and row bounds stop a
 * malformed server response from looping forever.
 *
 * Return `false` from `onPage` to stop early (for example after finding a
 * match or after collecting enough rows for the caller). Any other return
 * value continues to the next page while budget remains.
 */
export const forEachPageWithToken = async <T>(
  fetchPage: FetchCursorPage<T>,
  onPage: (
    items: readonly T[]
  ) => CursorPageVisitResult | Promise<CursorPageVisitResult>,
  {
    maxPages = defaultMaxPages,
    maxRows = defaultMaxRows,
    pageSize = defaultPageSize,
  }: CursorPageOptions = {}
): Promise<undefined> => {
  const visitedTokens = new Set<string>();
  let token = "";
  let pagesRead = 0;
  let rowsRead = 0;

  while (
    pagesRead < maxPages &&
    rowsRead < maxRows &&
    !visitedTokens.has(token)
  ) {
    visitedTokens.add(token);

    // Cap the request and the search window by remaining budget so maxRows is a
    // hard ceiling even when the caller sets pageSize higher, or a bad response
    // returns more items than the requested limit.
    const remainingRows = maxRows - rowsRead;
    const limit = Math.min(pageSize, remainingRows);
    // Sequential: each page depends on the previous response's nextToken.
    // oxlint-disable-next-line no-await-in-loop -- cursor pages cannot be fetched in parallel
    const { items, nextToken } = await fetchPage(token, limit);
    const pageItems = items.slice(0, remainingRows);
    // oxlint-disable-next-line no-await-in-loop -- onPage may be async; still sequential
    const shouldContinue = await onPage(pageItems);
    if (shouldContinue === false) {
      return;
    }

    rowsRead += pageItems.length;
    pagesRead += 1;
    if (!nextToken || rowsRead >= maxRows) {
      return;
    }
    token = nextToken;
  }
};

/**
 * Find one record by `publicId` across a cursor-paginated list RPC.
 *
 * Built on {@link forEachPageWithToken}; stops at the first match.
 */
export const findByPublicIdWithToken = async <T extends { publicId: string }>(
  publicId: string,
  fetchPage: FetchCursorPage<T>,
  options?: PublicIdLookupOptions
): Promise<T | null> => {
  let match: T | null = null;

  await forEachPageWithToken(
    fetchPage,
    (items) => {
      const found = items.find((item) => item.publicId === publicId);
      if (found) {
        match = found;
        return false;
      }
    },
    options
  );

  return match;
};
