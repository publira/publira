import { describe, expect, it } from "vitest";

import {
  invitationPageHrefs,
  memberPageHrefs,
  parseMembersSearchParams,
} from "./search-params";

describe("parseMembersSearchParams", () => {
  it("reads each list's token", () => {
    expect(
      parseMembersSearchParams({
        invitations_token: " inv ",
        members_token: "mem",
      })
    ).toEqual({ invitationsToken: "inv", membersToken: "mem" });
  });

  it("falls back to the first page on a repeated parameter", () => {
    expect(parseMembersSearchParams({ members_token: ["a", "b"] })).toEqual({
      invitationsToken: "",
      membersToken: "",
    });
  });
});

describe("page links", () => {
  const current = { invitationsToken: "inv", membersToken: "mem" };

  it("moves the member list and keeps the invitation page", () => {
    expect(
      memberPageHrefs(current, { nextToken: "next", previousToken: "" })
    ).toEqual({
      nextHref: "?invitations_token=inv&members_token=next",
      previousHref: undefined,
    });
  });

  it("moves the invitation list and keeps the member page", () => {
    expect(
      invitationPageHrefs(current, { nextToken: "", previousToken: "prev" })
    ).toEqual({
      nextHref: undefined,
      previousHref: "?invitations_token=prev&members_token=mem",
    });
  });

  it("leaves out the token of a list on its first page", () => {
    expect(
      memberPageHrefs(
        { invitationsToken: "", membersToken: "" },
        { nextToken: "next", previousToken: "" }
      )
    ).toEqual({ nextHref: "?members_token=next", previousHref: undefined });
  });
});
