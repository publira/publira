import { describe, expect, it } from "vitest";

import { buildTenantsPath, parseTenantFilters } from "./search-params";

const allowedStatuses = new Set(["active", "trial", "suspended"]);

describe("parseTenantFilters", () => {
  it("ページ token とフィルタを正規化する", () => {
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
      token: "page-token",
    });
  });

  it("複数値や不正な状態を空値にする", () => {
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
  it("フィルタとページ token を URL に保持する", () => {
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

  it("条件がなければ一覧のルートを返す", () => {
    expect(buildTenantsPath({ name: "", status: "", token: "" })).toBe(
      "/tenants"
    );
  });
});
