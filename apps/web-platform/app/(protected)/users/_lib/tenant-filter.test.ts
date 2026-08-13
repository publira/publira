import { describe, expect, it } from "vitest";

import { resolveTenantFilter } from "./tenant-filter";

const matches = [{ publicId: "tenant_a" }, { publicId: "tenant_b" }] as const;

describe("resolveTenantFilter", () => {
  it("検索語がなければ URL の tenant_id を使う", () => {
    expect(
      resolveTenantFilter({
        matches: [],
        searchOk: true,
        tenantId: "tenant_a",
        tenantQuery: "",
      })
    ).toEqual({ kind: "resolved", tenantId: "tenant_a" });
  });

  it("検索語も tenant_id もなければ未選択にする", () => {
    expect(
      resolveTenantFilter({
        matches: [],
        searchOk: true,
        tenantId: "",
        tenantQuery: "",
      })
    ).toEqual({ kind: "unselected" });
  });

  it("検索に失敗したときは既存の tenant_id を残す", () => {
    expect(
      resolveTenantFilter({
        matches: [],
        searchOk: false,
        tenantId: "tenant_a",
        tenantQuery: "出版",
      })
    ).toEqual({ kind: "resolved", tenantId: "tenant_a" });
  });

  it("検索結果に含まれる tenant_id を優先する", () => {
    expect(
      resolveTenantFilter({
        matches,
        searchOk: true,
        tenantId: "tenant_b",
        tenantQuery: "Tenant",
      })
    ).toEqual({ kind: "resolved", tenantId: "tenant_b" });
  });

  it("候補が 1 件ならそれを採用する", () => {
    expect(
      resolveTenantFilter({
        matches: [{ publicId: "tenant_a" }],
        searchOk: true,
        tenantId: "",
        tenantQuery: "出版",
      })
    ).toEqual({ kind: "resolved", tenantId: "tenant_a" });
  });

  it("候補が 0 件なら一覧を出さない未解決にする", () => {
    expect(
      resolveTenantFilter({
        matches: [],
        searchOk: true,
        tenantId: "tenant_z",
        tenantQuery: "存在しない",
      })
    ).toEqual({ kind: "none" });
  });

  it("複数候補で tenant_id が外れたら曖昧な未解決にする", () => {
    expect(
      resolveTenantFilter({
        matches,
        searchOk: true,
        tenantId: "tenant_z",
        tenantQuery: "Tenant",
      })
    ).toEqual({ kind: "ambiguous" });
  });
});
