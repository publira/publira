import { describe, expect, it } from "vitest";

import { MAX_LIST_OFFSET } from "#lib/list-pagination";

import { buildAuditLogsPath, parseAuditLogFilters } from "./search-params";

const allowedActions = new Set(["operator_created", "tenant_created"]);

describe("parseAuditLogFilters", () => {
  it("正規化したフィルタとオフセットを返す", () => {
    expect(
      parseAuditLogFilters(
        {
          action: " operator_created ",
          actor_user_public_id: " user_1 ",
          offset: "20",
        },
        allowedActions
      )
    ).toEqual({
      action: "operator_created",
      actorUserPublicId: "user_1",
      offset: 20,
    });
  });

  it("不正値・範囲外の値を既定値または上限にクランプする", () => {
    expect(
      parseAuditLogFilters(
        {
          action: "unknown",
          actor_user_public_id: ["a", "b"],
          offset: "abc",
        },
        allowedActions
      )
    ).toEqual({
      action: "",
      actorUserPublicId: "",
      offset: 0,
    });

    expect(parseAuditLogFilters({ offset: "-4" }, allowedActions).offset).toBe(
      0
    );
    expect(
      parseAuditLogFilters(
        { offset: String(MAX_LIST_OFFSET + 50) },
        allowedActions
      ).offset
    ).toBe(MAX_LIST_OFFSET);
  });
});

describe("buildAuditLogsPath", () => {
  it("フィルタとオフセットを URL に保持する", () => {
    expect(
      buildAuditLogsPath({
        action: "operator_created",
        actorUserPublicId: "user_1",
        offset: 20,
      })
    ).toBe(
      "/audit-logs?actor_user_public_id=user_1&action=operator_created&offset=20"
    );
  });

  it("条件がなければ一覧のルートを返す", () => {
    expect(
      buildAuditLogsPath({ action: "", actorUserPublicId: "", offset: 0 })
    ).toBe("/audit-logs");
  });
});
