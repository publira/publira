import { describe, expect, it } from "vitest";

import { resolveTenantFilter } from "./tenant-filter";

const matches = [{ publicId: "tenant_a" }, { publicId: "tenant_b" }] as const;

describe("resolveTenantFilter", () => {
  it("uses the tenant_id from the URL when there is no query", () => {
    expect(
      resolveTenantFilter({
        matches: [],
        searchOk: true,
        tenantId: "tenant_a",
        tenantQuery: "",
      })
    ).toEqual({ kind: "resolved", tenantId: "tenant_a" });
  });

  it("leaves the tenant unselected when there is no query or tenant_id", () => {
    expect(
      resolveTenantFilter({
        matches: [],
        searchOk: true,
        tenantId: "",
        tenantQuery: "",
      })
    ).toEqual({ kind: "unselected" });
  });

  it("keeps the existing tenant_id when searching fails", () => {
    expect(
      resolveTenantFilter({
        matches: [],
        searchOk: false,
        tenantId: "tenant_a",
        tenantQuery: "Press",
      })
    ).toEqual({ kind: "resolved", tenantId: "tenant_a" });
  });

  it("prefers a tenant_id included in the search results", () => {
    expect(
      resolveTenantFilter({
        matches,
        searchOk: true,
        tenantId: "tenant_b",
        tenantQuery: "Tenant",
      })
    ).toEqual({ kind: "resolved", tenantId: "tenant_b" });
  });

  it("selects the only candidate", () => {
    expect(
      resolveTenantFilter({
        matches: [{ publicId: "tenant_a" }],
        searchOk: true,
        tenantId: "",
        tenantQuery: "Press",
      })
    ).toEqual({ kind: "resolved", tenantId: "tenant_a" });
  });

  it("leaves the tenant unresolved without listing candidates when there are none", () => {
    expect(
      resolveTenantFilter({
        matches: [],
        searchOk: true,
        tenantId: "tenant_z",
        tenantQuery: "no-such-tenant",
      })
    ).toEqual({ kind: "none" });
  });

  it("leaves the tenant ambiguously unresolved when it is absent from multiple candidates", () => {
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
