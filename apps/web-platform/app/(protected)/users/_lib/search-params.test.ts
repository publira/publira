import { describe, expect, it } from "vitest";

import { buildUsersPath, parseUsersFilters } from "./search-params";

describe("parseUsersFilters", () => {
  it("normalizes filters and the page token", () => {
    expect(
      parseUsersFilters({
        created_from: " 2026-03-01 ",
        created_to: "2026-03-02",
        limit: "10",
        status: " active ",
        tenant_id: " tenant_a ",
        tenant_q: " 出版 ",
        token: "next-page",
      })
    ).toEqual({
      createdFrom: "2026-03-01",
      createdTo: "2026-03-02",
      limit: 10,
      status: "active",
      tenantId: "tenant_a",
      tenantQuery: "出版",
      token: "next-page",
    });
  });

  it("uses defaults for multiple or invalid values", () => {
    expect(
      parseUsersFilters({
        created_from: "2026-02-30",
        created_to: ["2026-03-01", "2026-03-02"],
        limit: "7",
        status: "unknown",
        tenant_id: ["tenant_a", "tenant_b"],
        tenant_q: ["出版", "別の出版"],
        token: ["first", "second"],
      })
    ).toEqual({
      createdFrom: "",
      createdTo: "",
      limit: 20,
      status: "",
      tenantId: "",
      tenantQuery: "",
      token: "",
    });
  });
});

describe("buildUsersPath", () => {
  it("keeps filters and the page token in the URL", () => {
    expect(
      buildUsersPath({
        createdFrom: "2026-03-01",
        createdTo: "2026-03-02",
        limit: 10,
        status: "suspended",
        tenantId: "tenant_a",
        tenantQuery: "出版",
        token: "next-page",
      })
    ).toBe(
      "/users?status=suspended&tenant_id=tenant_a&tenant_q=%E5%87%BA%E7%89%88&created_from=2026-03-01&created_to=2026-03-02&limit=10&token=next-page"
    );
  });

  it("returns the list root when there are no conditions", () => {
    expect(
      buildUsersPath({
        createdFrom: "",
        createdTo: "",
        limit: 20,
        status: "",
        tenantId: "",
        tenantQuery: "",
        token: "",
      })
    ).toBe("/users");
  });
});
