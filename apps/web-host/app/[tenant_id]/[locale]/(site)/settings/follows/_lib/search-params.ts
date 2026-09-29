import { z } from "zod";

import { cursorPageHref, cursorTokenSchema } from "#lib/cursor-token";

export const defaultFollowsPageSize = 20;

interface ParseFollowsSearchParamsInput {
  token?: string | string[] | undefined;
}

export interface FollowsSearchParams {
  /** Empty on the first page. */
  token: string;
}

const followsSearchParamsSchema = z.object({
  token: cursorTokenSchema,
});

export const parseFollowsSearchParams = (
  input: ParseFollowsSearchParamsInput
): FollowsSearchParams => followsSearchParamsSchema.parse(input);

export const followsListHref = (token: string): string =>
  cursorPageHref("/settings/follows", token);
