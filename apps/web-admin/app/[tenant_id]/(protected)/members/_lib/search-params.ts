import type { SearchParamValue } from "@publira/utils/search-params";
import { z } from "zod";

import type { CursorPageHrefs, CursorPageTokens } from "#lib/cursor-page";
import { cursorTokenSchema } from "#lib/cursor-page";
import { buildQueryString } from "#lib/query-string";

/**
 * Where each list on the screen is paged to. The two lists page on their own,
 * so each keeps its own token and a link that moves one carries the other.
 */
export interface MembersSearchParams {
  invitationsToken: string;
  membersToken: string;
}

const membersSearchParamsSchema = z.object({
  invitations_token: cursorTokenSchema,
  members_token: cursorTokenSchema,
});

export const parseMembersSearchParams = (input: {
  invitations_token?: SearchParamValue;
  members_token?: SearchParamValue;
}): MembersSearchParams => {
  const parsed = membersSearchParamsSchema.parse(input);

  return {
    invitationsToken: parsed.invitations_token,
    membersToken: parsed.members_token,
  };
};

const membersHref = (params: MembersSearchParams): string =>
  buildQueryString({
    invitations_token: params.invitationsToken,
    members_token: params.membersToken,
  }) || "?";

export const memberPageHrefs = (
  current: MembersSearchParams,
  { nextToken, previousToken }: CursorPageTokens
): CursorPageHrefs => ({
  nextHref: nextToken
    ? membersHref({ ...current, membersToken: nextToken })
    : undefined,
  previousHref: previousToken
    ? membersHref({ ...current, membersToken: previousToken })
    : undefined,
});

export const invitationPageHrefs = (
  current: MembersSearchParams,
  { nextToken, previousToken }: CursorPageTokens
): CursorPageHrefs => ({
  nextHref: nextToken
    ? membersHref({ ...current, invitationsToken: nextToken })
    : undefined,
  previousHref: previousToken
    ? membersHref({ ...current, invitationsToken: previousToken })
    : undefined,
});
