import { z } from "zod";

import { cursorPageHref, cursorTokenSchema } from "#lib/cursor-token";

export const defaultReadingHistoryPageSize = 20;

interface ParseMySearchParamsInput {
  token?: string | string[] | undefined;
}

export interface MySearchParams {
  token: string;
}

/**
 * `/my` shows one paginated list, the reading history, so the bare `token` is
 * unambiguous and reads the same way it does on `/my/library`.
 */
const mySearchParamsSchema = z.object({ token: cursorTokenSchema });

export const parseMySearchParams = (
  input: ParseMySearchParamsInput
): MySearchParams => mySearchParamsSchema.parse(input);

/**
 * `/my` at the history page the token names, which is both where the pager
 * links and where a reader sent to sign in has to come back to. Dropping the
 * token there would land them on page 1 of a history they were paging through.
 */
export const myPageHref = (token: string): string =>
  cursorPageHref("/my", token);
