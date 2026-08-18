import { z } from "zod";

import { cursorPageHref, cursorTokenSchema } from "#lib/cursor-token";

const labelDetailSearchParamsSchema = z.object({
  token: cursorTokenSchema,
});

interface ParseLabelDetailSearchParamsInput {
  token?: string | string[] | undefined;
}

export interface LabelDetailSearchParams {
  /** Empty on the first related-series page. */
  token: string;
}

export const parseLabelDetailSearchParams = (
  input: ParseLabelDetailSearchParamsInput
): LabelDetailSearchParams => labelDetailSearchParamsSchema.parse(input);

export const labelDetailHref = (labelId: string, token: string): string =>
  cursorPageHref(`/labels/${labelId}`, token);
