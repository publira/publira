import { z } from "zod";

import { cursorPageHref, cursorTokenSchema } from "#lib/cursor-token";

// public_id is 12 standard Base58 characters (server/internal/publicid).
const labelIdSchema = z
  .string()
  .trim()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{12}$/u);

const labelDetailParamsSchema = z.object({
  label_id: labelIdSchema,
});

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

export const parseLabelDetailParams = (input: {
  label_id: string;
}): string | null => {
  const parsed = labelDetailParamsSchema.safeParse(input);
  return parsed.success ? parsed.data.label_id : null;
};

export const parseLabelDetailSearchParams = (
  input: ParseLabelDetailSearchParamsInput
): LabelDetailSearchParams => labelDetailSearchParamsSchema.parse(input);

export const labelDetailHref = (labelId: string, token: string): string =>
  cursorPageHref(`/labels/${labelId}`, token);
