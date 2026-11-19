import { describe, expect, it } from "vitest";

import { parseAuditLogFilters } from "./search-params";

const allowedActions = new Set(["operator_created", "tenant_created"]);

describe("parseAuditLogFilters", () => {
  it("returns normalized filters and page token", () => {
    expect(
      parseAuditLogFilters(
        {
          action: " operator_created ",
          actor_user_public_id: " user_1 ",
          created_from: " 2026-01-01 ",
          created_to: "2026-01-31",
          tenant_id: " tenant_a ",
          token: "next-page",
        },
        allowedActions
      )
    ).toEqual({
      action: "operator_created",
      actorUserPublicId: "user_1",
      createdFrom: "2026-01-01",
      createdTo: "2026-01-31",
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
          created_from: "2026-02-30",
          created_to: "yesterday",
          tenant_id: ["tenant_a", "tenant_b"],
          token: ["first", "second"],
        },
        allowedActions
      )
    ).toEqual({
      action: "",
      actorUserPublicId: "",
      createdFrom: "",
      createdTo: "",
      tenantPublicId: "",
      token: "",
    });
  });
});
