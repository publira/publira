import { describe, expect, it } from "vitest";

import { loadPlatformMessages } from "./locale";
import {
  getTenantRoleLabel,
  getTenantStatusLabel,
  getTenantStatusTone,
} from "./tenant-labels";

const ja = await loadPlatformMessages("ja");
const en = await loadPlatformMessages("en");

describe("getTenantStatusLabel", () => {
  it("returns the active label for active", () => {
    expect(getTenantStatusLabel("active", ja)).toBe("稼働中");
  });

  it("locale=en uses the English catalog", () => {
    expect(getTenantStatusLabel("active", en)).toBe("Active");
  });

  it("returns the inactive label for inactive", () => {
    expect(getTenantStatusLabel("inactive", ja)).toBe("無効");
  });

  it("returns the suspended label for suspended", () => {
    expect(getTenantStatusLabel("suspended", ja)).toBe("停止中");
  });

  it("returns the trial label for trial", () => {
    expect(getTenantStatusLabel("trial", ja)).toBe("トライアル");
  });

  it("returns unknown values unchanged", () => {
    expect(getTenantStatusLabel("unknown_status", ja)).toBe("unknown_status");
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
    expect(getTenantRoleLabel("tenant_admin", ja)).toBe("テナント管理者");
  });

  it("returns the tenant editor label for tenant_editor", () => {
    expect(getTenantRoleLabel("tenant_editor", ja)).toBe("編集担当");
  });

  it("returns the tenant member label for tenant_member", () => {
    expect(getTenantRoleLabel("tenant_member", ja)).toBe("メンバー");
  });

  it("returns the tenant owner label for tenant_owner", () => {
    expect(getTenantRoleLabel("tenant_owner", ja)).toBe("オーナー");
  });

  it("returns unknown values unchanged", () => {
    expect(getTenantRoleLabel("custom_role", ja)).toBe("custom_role");
  });
});
