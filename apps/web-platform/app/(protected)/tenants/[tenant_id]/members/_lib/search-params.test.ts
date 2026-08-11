import { describe, expect, it } from "vitest";

import {
  buildMemberInvitationsPath,
  parseMemberInvitationFilters,
} from "./search-params";

describe("parseMemberInvitationFilters", () => {
  it("ページ token をそのまま受け取る", () => {
    expect(parseMemberInvitationFilters({ token: " page-token " })).toEqual({
      token: " page-token ",
    });
  });

  it("cursor token は長さや前後空白を含めて変更しない", () => {
    const token = ` ${"x".repeat(256)} `;

    expect(parseMemberInvitationFilters({ token }).token).toBe(token);
  });

  it("複数値や未指定は空文字にする", () => {
    expect(
      parseMemberInvitationFilters({ token: ["first", "second"] })
    ).toEqual({
      token: "",
    });
    expect(parseMemberInvitationFilters({})).toEqual({ token: "" });
  });
});

describe("buildMemberInvitationsPath", () => {
  it("ページ token を URL に保持する", () => {
    expect(
      buildMemberInvitationsPath("tenant_seifuu", { token: "next/page" })
    ).toBe("/tenants/tenant_seifuu/members?token=next%2Fpage");
  });

  it("token がなければメンバー画面のルートを返す", () => {
    expect(buildMemberInvitationsPath("tenant_seifuu", { token: "" })).toBe(
      "/tenants/tenant_seifuu/members"
    );
  });

  it("tenant id を URL エンコードする", () => {
    expect(buildMemberInvitationsPath("tenant/with space", { token: "" })).toBe(
      "/tenants/tenant%2Fwith%20space/members"
    );
  });
});
