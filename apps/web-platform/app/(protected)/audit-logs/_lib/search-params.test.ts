import { describe, expect, it } from "vitest";

import { buildAuditLogsPath, parseAuditLogFilters } from "./search-params";

const allowedActions = new Set(["operator_created", "tenant_created"]);

describe("parseAuditLogFilters", () => {
  it("正規化したフィルタとページ token を返す", () => {
    expect(
      parseAuditLogFilters(
        {
          action: " operator_created ",
          actor_user_public_id: " user_1 ",
          token: "next-page",
        },
        allowedActions
      )
    ).toEqual({
      action: "operator_created",
      actorUserPublicId: "user_1",
      token: "next-page",
    });
  });

  it("不正値を既定値にする", () => {
    expect(
      parseAuditLogFilters(
        {
          action: "unknown",
          actor_user_public_id: ["a", "b"],
          token: ["first", "second"],
        },
        allowedActions
      )
    ).toEqual({
      action: "",
      actorUserPublicId: "",
      token: "",
    });
  });
});

describe("buildAuditLogsPath", () => {
  it("フィルタとページ token を URL に保持する", () => {
    expect(
      buildAuditLogsPath({
        action: "operator_created",
        actorUserPublicId: "user_1",
        token: "next-page",
      })
    ).toBe(
      "/audit-logs?actor_user_public_id=user_1&action=operator_created&token=next-page"
    );
  });

  it("条件がなければ一覧のルートを返す", () => {
    expect(
      buildAuditLogsPath({ action: "", actorUserPublicId: "", token: "" })
    ).toBe("/audit-logs");
  });
});
