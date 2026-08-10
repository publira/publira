import { describe, expect, it } from "vitest";

import { parseAuditLogFilters } from "./search-params";

const allowedActions = new Set(["series_created"]);

describe("parseAuditLogFilters", () => {
  it("ページ token とフィルタを正規化する", () => {
    expect(
      parseAuditLogFilters(
        {
          action: " series_created ",
          actor: " USER001 ",
          from: "2026-08-01",
          to: "2026-08-10",
          token: " page-token ",
        },
        allowedActions
      )
    ).toEqual({
      action: "series_created",
      actor: "USER001",
      from: "2026-08-01",
      to: "2026-08-10",
      token: "page-token",
    });
  });

  it("複数値や不正なフィルタを空値にする", () => {
    expect(
      parseAuditLogFilters(
        {
          action: "unknown",
          actor: ["USER001", "USER002"],
          from: "2026/08/01",
          to: "",
          token: ["first", "second"],
        },
        allowedActions
      )
    ).toEqual({
      action: "",
      actor: "",
      from: "",
      to: "",
      token: "",
    });
  });
});
