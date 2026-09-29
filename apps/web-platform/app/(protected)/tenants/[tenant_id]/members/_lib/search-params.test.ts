import { describe, expect, it } from "vitest";

import {
  buildMemberInvitationsPath,
  buildMembersPath,
  parseMemberInvitationFilters,
} from "./search-params";

describe("parseMemberInvitationFilters", () => {
  it("accepts the page token unchanged", () => {
    expect(
      parseMemberInvitationFilters({
        members_token: " members-token ",
        token: " page-token ",
      })
    ).toEqual({
      membersToken: " members-token ",
      token: " page-token ",
    });
  });

  it("keeps the cursor token unchanged including length and whitespace", () => {
    const token = ` ${"x".repeat(256)} `;

    expect(parseMemberInvitationFilters({ token }).token).toBe(token);
  });

  it("uses an empty string for multiple or missing values", () => {
    expect(
      parseMemberInvitationFilters({
        members_token: ["first", "second"],
        token: ["first", "second"],
      })
    ).toEqual({
      membersToken: "",
      token: "",
    });
    expect(parseMemberInvitationFilters({})).toEqual({
      membersToken: "",
      token: "",
    });
  });
});

describe("buildMemberInvitationsPath", () => {
  it("keeps invitation and member tokens in the URL", () => {
    expect(
      buildMemberInvitationsPath("tenant_seifuu", {
        membersToken: "members/page",
        token: "next/page",
      })
    ).toBe(
      "/tenants/tenant_seifuu/members?token=next%2Fpage&members_token=members%2Fpage"
    );
  });

  it("returns the members root when there is no token", () => {
    expect(
      buildMemberInvitationsPath("tenant_seifuu", {
        membersToken: "",
        token: "",
      })
    ).toBe("/tenants/tenant_seifuu/members");
  });

  it("URL-encodes the tenant ID", () => {
    expect(
      buildMemberInvitationsPath("tenant/with space", {
        membersToken: "",
        token: "",
      })
    ).toBe("/tenants/tenant%2Fwith%20space/members");
  });
});

describe("buildMembersPath", () => {
  it("keeps the member list token in the URL", () => {
    expect(
      buildMembersPath("tenant_seifuu", {
        membersToken: "members-next",
        token: "invites",
      })
    ).toBe(
      "/tenants/tenant_seifuu/members?token=invites&members_token=members-next"
    );
  });
});
