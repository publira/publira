import { z } from "zod";

import { cursorPageHref, cursorTokenSchema } from "#lib/cursor-token";

const authorsListSearchParamsSchema = z.object({
  token: cursorTokenSchema,
});

interface ParseAuthorsListSearchParamsInput {
  token?: string | string[] | undefined;
}

export interface AuthorsListSearchParams {
  /** Empty on the first page. */
  token: string;
}

export const parseAuthorsListSearchParams = (
  input: ParseAuthorsListSearchParamsInput
): AuthorsListSearchParams => authorsListSearchParamsSchema.parse(input);

export const authorsListHref = (token: string): string =>
  cursorPageHref("/authors", token);
