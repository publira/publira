import { z } from "zod";

import { cursorPageHref, cursorTokenSchema } from "#lib/cursor-token";

type QueryParamValue = string | string[] | undefined;

interface ParseMemberInvitationFiltersInput {
  token?: QueryParamValue;
}

export interface MemberInvitationFilters {
  token: string;
}

const memberInvitationFiltersSchema = z.object({
  token: cursorTokenSchema,
});

export const parseMemberInvitationFilters = (
  input: ParseMemberInvitationFiltersInput
): MemberInvitationFilters => memberInvitationFiltersSchema.parse(input);

export const buildMemberInvitationsPath = (
  tenantId: string,
  { token }: MemberInvitationFilters
): string =>
  cursorPageHref(`/tenants/${encodeURIComponent(tenantId)}/members`, token);
