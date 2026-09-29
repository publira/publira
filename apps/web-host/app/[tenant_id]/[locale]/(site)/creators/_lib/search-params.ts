import { z } from "zod";

import { cursorPageHref, cursorTokenSchema } from "#lib/cursor-token";

const creatorsListSearchParamsSchema = z.object({
  token: cursorTokenSchema,
});

interface ParseCreatorsListSearchParamsInput {
  token?: string | string[] | undefined;
}

export interface CreatorsListSearchParams {
  /** Empty on the first page. */
  token: string;
}

export const parseCreatorsListSearchParams = (
  input: ParseCreatorsListSearchParamsInput
): CreatorsListSearchParams => creatorsListSearchParamsSchema.parse(input);

export const creatorsListHref = (token: string): string =>
  cursorPageHref("/creators", token);
