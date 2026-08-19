import { z } from "zod";

import { cursorTokenSchema } from "#lib/cursor-token";

type QueryParamValue = string | string[] | undefined;

interface ParseMemberPageSearchParamsInput {
  members_token?: QueryParamValue;
  token?: QueryParamValue;
}

export interface MemberPageSearchParams {
  membersToken: string;
  token: string;
}

const memberPageSearchParamsSchema = z.object({
  members_token: cursorTokenSchema,
  token: cursorTokenSchema,
});

export const parseMemberInvitationFilters = (
  input: ParseMemberPageSearchParamsInput
): MemberPageSearchParams => {
  const parsed = memberPageSearchParamsSchema.parse(input);
  return {
    membersToken: parsed.members_token,
    token: parsed.token,
  };
};

const membersPagePath = (
  tenantId: string,
  { membersToken, token }: MemberPageSearchParams
): string => {
  const search = new URLSearchParams();
  if (token) {
    search.set("token", token);
  }
  if (membersToken) {
    search.set("members_token", membersToken);
  }
  const query = search.toString();
  const pathname = `/tenants/${encodeURIComponent(tenantId)}/members`;
  return query ? `${pathname}?${query}` : pathname;
};

export const buildMemberInvitationsPath = (
  tenantId: string,
  params: MemberPageSearchParams
): string => membersPagePath(tenantId, params);

export const buildMembersPath = (
  tenantId: string,
  params: MemberPageSearchParams
): string => membersPagePath(tenantId, params);
