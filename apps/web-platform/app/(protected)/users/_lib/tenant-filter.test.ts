import { describe, expect, it } from "vitest";

import { resolveTenantFilterId } from "./tenant-filter";

const matches = [{ publicId: "tenant_a" }, { publicId: "tenant_b" }] as const;

describe("resolveTenantFilterId", () => {
  it("検索語がなければ URL の tenant_id を使う", () => {
    expect(
      resolveTenantFilterId({
        matches: [],
        searchOk: true,
        tenantId: "tenant_a",
        tenantQuery: "",
      })
    ).toBe("tenant_a");
  });

  it("検索に失敗したときは既存の tenant_id を残す", () => {
    expect(
      resolveTenantFilterId({
        matches: [],
        searchOk: false,
        tenantId: "tenant_a",
        tenantQuery: "出版",
      })
    ).toBe("tenant_a");
  });

  it("検索結果に含まれる tenant_id を優先する", () => {
    expect(
      resolveTenantFilterId({
        matches,
        searchOk: true,
        tenantId: "tenant_b",
        tenantQuery: "Tenant",
      })
    ).toBe("tenant_b");
  });

  it("候補が 1 件ならそれを採用する", () => {
    expect(
      resolveTenantFilterId({
        matches: [{ publicId: "tenant_a" }],
        searchOk: true,
        tenantId: "",
        tenantQuery: "出版",
      })
    ).toBe("tenant_a");
  });

  it("複数候補で tenant_id が外れたら未選択にする", () => {
    expect(
      resolveTenantFilterId({
        matches,
        searchOk: true,
        tenantId: "tenant_z",
        tenantQuery: "Tenant",
      })
    ).toBe("");
  });
});
