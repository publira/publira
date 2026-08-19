import { describe, expect, it } from "vitest";

import {
  buildMemberInvitationsPath,
  buildMembersPath,
  parseMemberInvitationFilters,
} from "./search-params";

describe("parseMemberInvitationFilters", () => {
  it("ページ token をそのまま受け取る", () => {
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

  it("cursor token は長さや前後空白を含めて変更しない", () => {
    const token = ` ${"x".repeat(256)} `;

    expect(parseMemberInvitationFilters({ token }).token).toBe(token);
  });

  it("複数値や未指定は空文字にする", () => {
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
  it("招待とメンバーの token を URL に保持する", () => {
    expect(
      buildMemberInvitationsPath("tenant_seifuu", {
        membersToken: "members/page",
        token: "next/page",
      })
    ).toBe(
      "/tenants/tenant_seifuu/members?token=next%2Fpage&members_token=members%2Fpage"
    );
  });

  it("token がなければメンバー画面のルートを返す", () => {
    expect(
      buildMemberInvitationsPath("tenant_seifuu", {
        membersToken: "",
        token: "",
      })
    ).toBe("/tenants/tenant_seifuu/members");
  });

  it("tenant id を URL エンコードする", () => {
    expect(
      buildMemberInvitationsPath("tenant/with space", {
        membersToken: "",
        token: "",
      })
    ).toBe("/tenants/tenant%2Fwith%20space/members");
  });
});

describe("buildMembersPath", () => {
  it("メンバー一覧の token を URL に保持する", () => {
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
