import { describe, expect, it } from "vitest";

import { buildUsersPath, parseUsersFilters } from "./search-params";

describe("parseUsersFilters", () => {
  it("フィルタとページ位置を正規化する", () => {
    expect(
      parseUsersFilters({
        created_from: " 2026-03-01 ",
        created_to: "2026-03-02",
        limit: "10",
        offset: "20",
        status: " active ",
        tenant_id: " tenant_a ",
        tenant_q: " 出版 ",
      })
    ).toEqual({
      createdFrom: "2026-03-01",
      createdTo: "2026-03-02",
      limit: 10,
      offset: 20,
      status: "active",
      tenantId: "tenant_a",
      tenantQuery: "出版",
    });
  });

  it("複数値や不正な値をデフォルトにする", () => {
    expect(
      parseUsersFilters({
        created_from: "2026-02-30",
        created_to: ["2026-03-01", "2026-03-02"],
        limit: "7",
        offset: "-4",
        status: "unknown",
        tenant_id: ["tenant_a", "tenant_b"],
        tenant_q: ["出版", "別の出版"],
      })
    ).toEqual({
      createdFrom: "",
      createdTo: "",
      limit: 20,
      offset: 0,
      status: "",
      tenantId: "",
      tenantQuery: "",
    });
  });
});

describe("buildUsersPath", () => {
  it("フィルタとページ位置を URL に保持する", () => {
    expect(
      buildUsersPath({
        createdFrom: "2026-03-01",
        createdTo: "2026-03-02",
        limit: 10,
        offset: 20,
        status: "suspended",
        tenantId: "tenant_a",
        tenantQuery: "出版",
      })
    ).toBe(
      "/users?status=suspended&tenant_id=tenant_a&tenant_q=%E5%87%BA%E7%89%88&created_from=2026-03-01&created_to=2026-03-02&limit=10&offset=20"
    );
  });

  it("条件がなければ一覧のルートを返す", () => {
    expect(
      buildUsersPath({
        createdFrom: "",
        createdTo: "",
        limit: 20,
        offset: 0,
        status: "",
        tenantId: "",
        tenantQuery: "",
      })
    ).toBe("/users");
  });
});
