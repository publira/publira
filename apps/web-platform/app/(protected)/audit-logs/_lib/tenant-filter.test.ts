import { describe, expect, it } from "vitest";

import type { PlatformTenantDetail } from "#lib/tenants";

import { resolveAuditLogTenantFilter } from "./tenant-filter";

const tenant: PlatformTenantDetail = {
  adminDomain: "admin.example.com",
  createdAt: "2026-03-01T00:00:00Z",
  domain: "example.com",
  id: "0190c6a4-0000-7000-8000-000000000001",
  name: "Example Press",
  publicId: "tenantPublic1",
  status: "active",
};

describe("resolveAuditLogTenantFilter", () => {
  it("applies no filter when the URL names no tenant", () => {
    expect(resolveAuditLogTenantFilter("", { ok: true, tenant: null })).toEqual(
      { kind: "none" }
    );
  });

  it("filters on the internal ID of the tenant the public ID names", () => {
    expect(
      resolveAuditLogTenantFilter("tenantPublic1", { ok: true, tenant })
    ).toEqual({
      kind: "resolved",
      label: "Example Press",
      tenantId: "0190c6a4-0000-7000-8000-000000000001",
    });
  });

  it("labels a tenant without a name by the public ID the URL carries", () => {
    expect(
      resolveAuditLogTenantFilter("tenantPublic1", {
        ok: true,
        tenant: { ...tenant, name: " " },
      })
    ).toMatchObject({ kind: "resolved", label: "tenantPublic1" });
  });

  it("keeps the filter for a tenant that does not exist", () => {
    expect(
      resolveAuditLogTenantFilter("missing", { ok: true, tenant: null })
    ).toEqual({ kind: "unknown", label: "missing" });
  });

  it("keeps the filter and the reason when the tenant could not be read", () => {
    expect(
      resolveAuditLogTenantFilter("tenantPublic1", {
        message: "The request failed.",
        ok: false,
      })
    ).toEqual({
      kind: "failed",
      label: "tenantPublic1",
      message: "The request failed.",
    });
  });
});
