import { z } from "zod";

import { cursorPageHref, cursorTokenSchema } from "#lib/cursor-token";

const labelsListSearchParamsSchema = z.object({
  token: cursorTokenSchema,
});

interface ParseLabelsListSearchParamsInput {
  token?: string | string[] | undefined;
}

export interface LabelsListSearchParams {
  /** Empty on the first page. */
  token: string;
}

export const parseLabelsListSearchParams = (
  input: ParseLabelsListSearchParamsInput
): LabelsListSearchParams => labelsListSearchParamsSchema.parse(input);

export const labelsListHref = (token: string): string =>
  cursorPageHref("/labels", token);
