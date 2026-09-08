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

export const readingHistoryHref = (token: string): string =>
  cursorPageHref("/my", token);
