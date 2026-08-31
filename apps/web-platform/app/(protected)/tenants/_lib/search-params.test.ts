import { describe, expect, it } from "vitest";

import { buildTenantsPath, parseTenantFilters } from "./search-params";

const allowedStatuses = new Set(["active", "trial", "suspended"]);

describe("parseTenantFilters", () => {
  it("normalizes the page token and filters", () => {
    expect(
      parseTenantFilters(
        {
          name: " テスト出版 ",
          status: " active ",
          token: " page-token ",
        },
        allowedStatuses
      )
    ).toEqual({
      name: "テスト出版",
      status: "active",
      token: " page-token ",
    });
  });

  it("keeps the cursor token unchanged including length and whitespace", () => {
    const token = ` ${"x".repeat(256)} `;

    expect(parseTenantFilters({ token }, allowedStatuses).token).toBe(token);
  });

  it("uses an empty value for multiple values or an invalid status", () => {
    expect(
      parseTenantFilters(
        {
          name: ["テスト出版", "サンプル出版"],
          status: "unknown",
          token: ["first", "second"],
        },
        allowedStatuses
      )
    ).toEqual({
      name: "",
      status: "",
      token: "",
    });
  });
});

describe("buildTenantsPath", () => {
  it("keeps filters and the page token in the URL", () => {
    expect(
      buildTenantsPath({
        name: "テスト 出版",
        status: "active",
        token: "next/page",
      })
    ).toBe(
      "/tenants?name=%E3%83%86%E3%82%B9%E3%83%88+%E5%87%BA%E7%89%88&status=active&token=next%2Fpage"
    );
  });

  it("returns the list root when there are no conditions", () => {
    expect(buildTenantsPath({ name: "", status: "", token: "" })).toBe(
      "/tenants"
    );
  });
});
