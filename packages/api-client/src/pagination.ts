const defaultPageSize = 100;
const defaultMaxRows = 10_000;
const defaultMaxPages = 100;

export interface PublicIdLookupOptions {
  maxPages?: number;
  maxRows?: number;
  pageSize?: number;
}

/**
 * Find one record by `publicId` across a cursor-paginated list RPC.
 *
 * Pages are read sequentially because each request depends on the token from
 * the previous response. Repeated tokens plus page and row bounds stop a
 * malformed server response from recursing forever.
 */
export const findByPublicIdWithToken = <T extends { publicId: string }>(
  publicId: string,
  fetchPage: (
    token: string,
    limit: number
  ) => Promise<{ items: readonly T[]; nextToken: string }>,
  {
    maxPages = defaultMaxPages,
    maxRows = defaultMaxRows,
    pageSize = defaultPageSize,
  }: PublicIdLookupOptions = {}
): Promise<T | null> => {
  const visitedTokens = new Set<string>();

  const fromToken = async (
    token: string,
    pagesRead: number,
    rowsRead: number
  ): Promise<T | null> => {
    if (
      pagesRead >= maxPages ||
      rowsRead >= maxRows ||
      visitedTokens.has(token)
    ) {
      return null;
    }
    visitedTokens.add(token);

    const { items, nextToken } = await fetchPage(token, pageSize);
    const match = items.find((item) => item.publicId === publicId);
    if (match) {
      return match;
    }
    if (!nextToken) {
      return null;
    }

    return fromToken(nextToken, pagesRead + 1, rowsRead + items.length);
  };

  return fromToken("", 0, 0);
};
