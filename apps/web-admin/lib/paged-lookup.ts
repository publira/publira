/**
 * The largest page the admin list RPCs will serve: the handlers fall back to 20
 * for any `limit` above this (`server/api/adminapi/creator_label_handlers.go`).
 */
export const ADMIN_LIST_PAGE_SIZE = 100;

/**
 * Safety stop for the walk below, in rows. The walk normally ends on the first
 * short page; this only bounds the damage if a handler ever stopped honouring
 * `offset`, so that a lookup fails instead of recursing forever.
 */
const ADMIN_LOOKUP_MAX_ROWS = 10_000;

/**
 * Find one record by `publicId` across a paginated list RPC.
 *
 * Neither `creator.proto` nor `label.proto` has a single-record `Get`, so the
 * only way to reach one is to walk the list. One page is not enough to conclude
 * "not found": the server caps a page at `ADMIN_LIST_PAGE_SIZE`, and answering
 * `notFound()` from the first page alone would make every record past that
 * point uneditable.
 *
 * Written as recursion rather than a loop because that is what the walk
 * actually is: the next page is requested only if this one came back full and
 * without a match. `no-await-in-loop` would reject the loop form, and its
 * advice — collect the promises and `Promise.all()` them — cannot apply, since
 * how many pages exist is only known from the previous response.
 *
 * Shared by `getCreator()` and `getLabel()` so the stop condition cannot be
 * fixed in one of them and missed in the other. A single-record RPC on either
 * service would retire that service's use of this helper.
 */
export const findByPublicId = <T extends { publicId: string }>(
  publicId: string,
  fetchPage: (offset: number, limit: number) => Promise<readonly T[]>
): Promise<T | null> => {
  const fromOffset = async (offset: number): Promise<T | null> => {
    if (offset >= ADMIN_LOOKUP_MAX_ROWS) {
      return null;
    }

    const items = await fetchPage(offset, ADMIN_LIST_PAGE_SIZE);

    const match = items.find((item) => item.publicId === publicId);
    if (match) {
      return match;
    }
    if (items.length < ADMIN_LIST_PAGE_SIZE) {
      return null;
    }

    return fromOffset(offset + ADMIN_LIST_PAGE_SIZE);
  };

  return fromOffset(0);
};

/**
 * Cursor-based counterpart of `findByPublicId` for migrated list RPCs.
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
