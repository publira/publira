import { z } from "zod";

type QueryParamValue = string | string[] | undefined;

interface ParseMemberInvitationFiltersInput {
  token?: QueryParamValue;
}

export interface MemberInvitationFilters {
  token: string;
}

/**
 * Opaque cursor tokens are forwarded as-is (`proto/README.md`). Only reject
 * non-string shapes (e.g. repeated query params) so a hand-edited URL falls
 * back to the first page instead of crashing the route.
 */
const cursorTokenSchema = z.preprocess(
  (value) => (typeof value === "string" ? value : ""),
  z.string()
);

const memberInvitationFiltersSchema = z.object({
  token: cursorTokenSchema,
});

export const parseMemberInvitationFilters = (
  input: ParseMemberInvitationFiltersInput
): MemberInvitationFilters => memberInvitationFiltersSchema.parse(input);

export const buildMemberInvitationsPath = (
  tenantId: string,
  { token }: MemberInvitationFilters
): string => {
  const pathname = `/tenants/${encodeURIComponent(tenantId)}/members`;
  if (!token) {
    return pathname;
  }

  const search = new URLSearchParams();
  search.set("token", token);
  return `${pathname}?${search.toString()}`;
};
