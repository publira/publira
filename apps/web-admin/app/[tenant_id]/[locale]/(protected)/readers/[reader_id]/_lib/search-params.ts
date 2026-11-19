import { z } from "zod";

import { cursorTokenSchema } from "#lib/cursor-page";
import { buildQueryString } from "#lib/query-string";

/**
 * The page of each list the reader page holds. Every section pages on its
 * own, so each keeps its own cursor; the comments' is `token`, as it was
 * before the page held another list.
 */
const readerPageSearchParamsSchema = z.object({
  purchases_token: cursorTokenSchema,
  tickets_token: cursorTokenSchema,
  token: cursorTokenSchema,
});

export type ReaderPageCursors = z.output<typeof readerPageSearchParamsSchema>;

export const parseReaderPageCursors = (
  searchParams: Record<string, string | string[] | undefined>
): ReaderPageCursors => readerPageSearchParamsSchema.parse(searchParams);

/**
 * The query of the reader page with one section moved to another page and
 * every other section left on the page it shows.
 */
export const readerPageHref = (
  cursors: ReaderPageCursors,
  change: Partial<ReaderPageCursors>
): string => buildQueryString({ ...cursors, ...change }) || "?";
