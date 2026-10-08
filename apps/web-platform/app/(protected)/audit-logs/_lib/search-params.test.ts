import { describe, expect, it } from "vitest";

import { buildAuditLogsPath, parseAuditLogFilters } from "./search-params";

const allowedActions = new Set(["operator_created", "tenant_created"]);

describe("parseAuditLogFilters", () => {
  it("returns normalized filters and page token", () => {
    expect(
      parseAuditLogFilters(
        {
          action: " operator_created ",
          actor_user_public_id: " user_1 ",
          tenant_id: " tenant_a ",
          token: "next-page",
        },
        allowedActions
      )
    ).toEqual({
      action: "operator_created",
      actorUserPublicId: "user_1",
      tenantPublicId: "tenant_a",
      token: "next-page",
    });
  });

  it("falls back to defaults for invalid values", () => {
    expect(
      parseAuditLogFilters(
        {
          action: "unknown",
          actor_user_public_id: ["a", "b"],
          tenant_id: ["tenant_a", "tenant_b"],
          token: ["first", "second"],
        },
        allowedActions
      )
    ).toEqual({
      action: "",
      actorUserPublicId: "",
      tenantPublicId: "",
      token: "",
    });
  });
});

describe("buildAuditLogsPath", () => {
  it("keeps filters and page token in the URL", () => {
    expect(
      buildAuditLogsPath({
        action: "operator_created",
        actorUserPublicId: "user_1",
        tenantPublicId: "tenant_a",
        token: "next-page",
      })
    ).toBe(
      "/audit-logs?tenant_id=tenant_a&actor_user_public_id=user_1&action=operator_created&token=next-page"
    );
  });

  it("returns the list root when there are no conditions", () => {
    expect(
      buildAuditLogsPath({
        action: "",
        actorUserPublicId: "",
        tenantPublicId: "",
        token: "",
      })
    ).toBe("/audit-logs");
  });
});
