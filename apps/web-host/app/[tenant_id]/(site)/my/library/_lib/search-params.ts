import { z } from "zod";

import { cursorPageHref, cursorTokenSchema } from "#lib/cursor-token";

export const defaultPurchasesPageSize = 20;

interface ParsePurchasesSearchParamsInput {
  token?: string | string[] | undefined;
}
export interface PurchasesSearchParams {
  token: string;
}

const purchasesSearchParamsSchema = z.object({ token: cursorTokenSchema });

export const parsePurchasesSearchParams = (
  input: ParsePurchasesSearchParamsInput
): PurchasesSearchParams => purchasesSearchParamsSchema.parse(input);

export const purchasesListHref = (token: string): string =>
  cursorPageHref("/my/library", token);
