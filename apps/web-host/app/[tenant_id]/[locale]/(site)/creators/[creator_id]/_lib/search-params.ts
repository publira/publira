import { z } from "zod";

import { cursorPageHref, cursorTokenSchema } from "#lib/cursor-token";

const creatorDetailSearchParamsSchema = z.object({
  token: cursorTokenSchema,
});

interface ParseCreatorDetailSearchParamsInput {
  token?: string | string[] | undefined;
}

export interface CreatorDetailSearchParams {
  /** Empty on the first related-series page. */
  token: string;
}

export const parseCreatorDetailSearchParams = (
  input: ParseCreatorDetailSearchParamsInput
): CreatorDetailSearchParams => creatorDetailSearchParamsSchema.parse(input);

export const creatorDetailHref = (creatorId: string, token: string): string =>
  cursorPageHref(`/creators/${creatorId}`, token);
