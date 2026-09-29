import { z } from "zod";

import { buildQueryString } from "./query-string";

/**
 * Rows one list page asks for. The server clamps `limit` on its own, so this is
 * only the console's choice of how much fits on a screen.
 */
export const DEFAULT_PAGE_SIZE = 20;

type QueryParamValue = string | string[] | undefined;

export interface CursorPageOptions {
  limit?: number;
  token?: string;
}

export interface CursorPageTokens {
  nextToken: string;
  previousToken: string;
}

export interface CursorPageHrefs {
  nextHref?: string;
  previousHref?: string;
}

export interface CursorSearchParams {
  token: string;
}

/**
 * Cursor tokens are opaque, so the only check the UI can make is that the value
 * arrived as a single string. Anything else falls back to the first page.
 */
export const cursorTokenSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim() : ""),
  z.string()
);

const cursorSearchParamsSchema = z.object({
  token: cursorTokenSchema,
});

/**
 * Read the cursor out of `searchParams`. Screens that also carry filters build
 * their own schema on {@link cursorTokenSchema} instead.
 */
export const parseCursorSearchParams = (input: {
  token?: QueryParamValue;
}): CursorSearchParams => cursorSearchParamsSchema.parse(input);

/** The paging fields every cursor list RPC takes, with the defaults applied. */
export const cursorPageRequest = ({
  limit,
  token,
}: CursorPageOptions = {}): Required<CursorPageOptions> => ({
  limit: limit ?? DEFAULT_PAGE_SIZE,
  token: token ?? "",
});

export const emptyCursorPageTokens = {
  nextToken: "",
  previousToken: "",
} as const satisfies CursorPageTokens;

/**
 * The boundary tokens of a response, normalized to empty strings so a screen
 * never has to tell "no further page" from "field absent".
 */
export const cursorPageTokens = (response: {
  nextToken?: string;
  previousToken?: string;
}): CursorPageTokens => ({
  nextToken: response.nextToken ?? "",
  previousToken: response.previousToken ?? "",
});

/**
 * Query-only href, so a page link stays on the route it was rendered from
 * without the caller having to know the tenant or resource segments.
 */
export const cursorPageHref = (token: string): string =>
  buildQueryString({ token }) || "?";

/** Page links, or `undefined` where the list has no page in that direction. */
export const cursorPageHrefs = ({
  nextToken,
  previousToken,
}: CursorPageTokens): CursorPageHrefs => ({
  nextHref: nextToken ? cursorPageHref(nextToken) : undefined,
  previousHref: previousToken ? cursorPageHref(previousToken) : undefined,
});

/**
 * Whether the list spans more than the page being rendered. A list without page
 * links holds every row it has, which is what lets a screen tell an empty list
 * from a page that lost its rows.
 */
export const hasCursorPageLinks = ({
  nextHref,
  previousHref,
}: CursorPageHrefs): boolean => Boolean(previousHref) || Boolean(nextHref);
