import type { SearchParamValue } from "@publira/utils/search-params";
import { z } from "zod";

import { authTokenSearchParamSchema } from "#lib/auth-input";

interface ParseAcceptInviteSearchParamsInput {
  token?: SearchParamValue;
}

export interface AcceptInviteSearchParams {
  token: string;
}

const acceptInviteSearchParamsSchema = z.object({
  token: authTokenSearchParamSchema,
});

export const parseAcceptInviteSearchParams = (
  input: ParseAcceptInviteSearchParamsInput
): AcceptInviteSearchParams => acceptInviteSearchParamsSchema.parse(input);
