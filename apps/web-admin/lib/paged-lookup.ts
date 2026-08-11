/**
 * The largest page the admin list RPCs will serve: the handlers fall back to 20
 * for any `limit` above this (`server/api/adminapi/creator_label_handlers.go`).
 */
export const ADMIN_LIST_PAGE_SIZE = 100;

/** Safety stop for sequential page walks, measured in rows. */
const ADMIN_LOOKUP_MAX_ROWS = 10_000;

/**
 * Find one record by `publicId` across a cursor-paginated list RPC.
 *
 * Pages have to be read sequentially because each request depends on the token
 * returned by the previous response. Repeated tokens are rejected locally so a
 * malformed server response cannot make the lookup recurse forever.
 */
export const findByPublicIdWithToken = <T extends { publicId: string }>(
  publicId: string,
  fetchPage: (
    token: string,
    limit: number
  ) => Promise<{ items: readonly T[]; nextToken: string }>
): Promise<T | null> => {
  const visitedTokens = new Set<string>();

  const fromToken = async (
    token: string,
    rowsRead: number
  ): Promise<T | null> => {
    if (rowsRead >= ADMIN_LOOKUP_MAX_ROWS || visitedTokens.has(token)) {
      return null;
    }
    visitedTokens.add(token);

    const { items, nextToken } = await fetchPage(token, ADMIN_LIST_PAGE_SIZE);
    const match = items.find((item) => item.publicId === publicId);
    if (match) {
      return match;
    }
    if (!nextToken) {
      return null;
    }

    return fromToken(nextToken, rowsRead + items.length);
  };

  return fromToken("", 0);
};
