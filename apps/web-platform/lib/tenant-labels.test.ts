import { describe, expect, it } from "vitest";

import {
  getTenantRoleLabel,
  getTenantStatusLabel,
  getTenantStatusTone,
} from "./tenant-labels";

const en = "en" as const;

describe("getTenantStatusLabel", () => {
  it("returns the active label for active", async () => {
    await expect(getTenantStatusLabel("active", en)).resolves.toBe("Active");
  });

  it("returns the inactive label for inactive", async () => {
    await expect(getTenantStatusLabel("inactive", en)).resolves.toBe(
      "Inactive"
    );
  });

  it("returns the suspended label for suspended", async () => {
    await expect(getTenantStatusLabel("suspended", en)).resolves.toBe(
      "Suspended"
    );
  });

  it("returns the trial label for trial", async () => {
    await expect(getTenantStatusLabel("trial", en)).resolves.toBe("Trial");
  });

  it("returns unknown values unchanged", async () => {
    await expect(getTenantStatusLabel("unknown_status", en)).resolves.toBe(
      "unknown_status"
    );
  });

  it("returns a name Object.prototype carries unchanged", async () => {
    await expect(getTenantStatusLabel("toString", en)).resolves.toBe(
      "toString"
    );
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
  it("returns the tenant administrator label for tenant_admin", async () => {
    await expect(getTenantRoleLabel("tenant_admin", en)).resolves.toBe(
      "Tenant admin"
    );
  });

  it("returns the tenant editor label for tenant_editor", async () => {
    await expect(getTenantRoleLabel("tenant_editor", en)).resolves.toBe(
      "Editor"
    );
  });

  it("returns the tenant member label for tenant_member", async () => {
    await expect(getTenantRoleLabel("tenant_member", en)).resolves.toBe(
      "Member"
    );
  });

  it("returns the tenant owner label for tenant_owner", async () => {
    await expect(getTenantRoleLabel("tenant_owner", en)).resolves.toBe("Owner");
  });

  it("returns unknown values unchanged", async () => {
    await expect(getTenantRoleLabel("custom_role", en)).resolves.toBe(
      "custom_role"
    );
  });

  it("returns a name Object.prototype carries unchanged", async () => {
    await expect(getTenantRoleLabel("constructor", en)).resolves.toBe(
      "constructor"
    );
  });
});
