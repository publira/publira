import { z } from "zod";

import { cursorPageHref, cursorTokenSchema } from "#lib/cursor-token";

const authorDetailSearchParamsSchema = z.object({
  token: cursorTokenSchema,
});

interface ParseAuthorDetailSearchParamsInput {
  token?: string | string[] | undefined;
}

export interface AuthorDetailSearchParams {
  /** Empty on the first related-series page. */
  token: string;
}

export const parseAuthorDetailSearchParams = (
  input: ParseAuthorDetailSearchParamsInput
): AuthorDetailSearchParams => authorDetailSearchParamsSchema.parse(input);

export const authorDetailHref = (authorId: string, token: string): string =>
  cursorPageHref(`/authors/${authorId}`, token);
