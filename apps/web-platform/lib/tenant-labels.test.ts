import { describe, expect, it } from "vitest";

import { loadPlatformMessages } from "./locale";
import {
  getTenantRoleLabel,
  getTenantStatusLabel,
  getTenantStatusTone,
} from "./tenant-labels";

const en = await loadPlatformMessages("en");

describe("getTenantStatusLabel", () => {
  it("returns the active label for active", () => {
    expect(getTenantStatusLabel("active", en)).toBe("Active");
  });

  it("returns the inactive label for inactive", () => {
    expect(getTenantStatusLabel("inactive", en)).toBe("Inactive");
  });

  it("returns the suspended label for suspended", () => {
    expect(getTenantStatusLabel("suspended", en)).toBe("Suspended");
  });

  it("returns the trial label for trial", () => {
    expect(getTenantStatusLabel("trial", en)).toBe("Trial");
  });

  it("returns unknown values unchanged", () => {
    expect(getTenantStatusLabel("unknown_status", en)).toBe("unknown_status");
  });
});

describe("getTenantStatusTone", () => {
  it("active → success", () => {
    expect(getTenantStatusTone("active")).toBe("success");
  });

  it("suspended → destructive", () => {
    expect(getTenantStatusTone("suspended")).toBe("destructive");
  });

  it("inactive → info", () => {
    expect(getTenantStatusTone("inactive")).toBe("info");
  });

  it("trial → info", () => {
    expect(getTenantStatusTone("trial")).toBe("info");
  });

  it("returns info for unknown values", () => {
    expect(getTenantStatusTone("unknown")).toBe("info");
  });
});

describe("getTenantRoleLabel", () => {
  it("returns the tenant administrator label for tenant_admin", () => {
    expect(getTenantRoleLabel("tenant_admin", en)).toBe("Tenant admin");
  });

  it("returns the tenant editor label for tenant_editor", () => {
    expect(getTenantRoleLabel("tenant_editor", en)).toBe("Editor");
  });

  it("returns the tenant member label for tenant_member", () => {
    expect(getTenantRoleLabel("tenant_member", en)).toBe("Member");
  });

  it("returns the tenant owner label for tenant_owner", () => {
    expect(getTenantRoleLabel("tenant_owner", en)).toBe("Owner");
  });

  it("returns unknown values unchanged", () => {
    expect(getTenantRoleLabel("custom_role", en)).toBe("custom_role");
  });
});
