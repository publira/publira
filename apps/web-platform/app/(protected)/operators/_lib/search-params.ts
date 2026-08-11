import { z } from "zod";

import { cursorPageHref, cursorTokenSchema } from "#lib/cursor-token";

type QueryParamValue = string | string[] | undefined;

interface ParseOperatorsSearchParamsInput {
  token?: QueryParamValue;
}

export interface OperatorsSearchParams {
  token: string;
}

const operatorsSearchParamsSchema = z.object({
  token: cursorTokenSchema,
});

export const parseOperatorsSearchParams = (
  input: ParseOperatorsSearchParamsInput
): OperatorsSearchParams => operatorsSearchParamsSchema.parse(input);

export const buildOperatorsPath = ({ token }: OperatorsSearchParams): string =>
  cursorPageHref("/operators", token);
