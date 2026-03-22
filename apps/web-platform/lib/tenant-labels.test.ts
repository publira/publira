import { describe, expect, it } from "vitest";

import {
  getTenantRoleLabel,
  getTenantStatusLabel,
  getTenantStatusTone,
} from "./tenant-labels";

describe("getTenantStatusLabel", () => {
  it("active → 稼働中", () => {
    expect(getTenantStatusLabel("active")).toBe("稼働中");
  });

  it("inactive → 無効", () => {
    expect(getTenantStatusLabel("inactive")).toBe("無効");
  });

  it("suspended → 停止中", () => {
    expect(getTenantStatusLabel("suspended")).toBe("停止中");
  });

  it("trial → トライアル", () => {
    expect(getTenantStatusLabel("trial")).toBe("トライアル");
  });

  it("未知の値はそのまま返す", () => {
    expect(getTenantStatusLabel("unknown_status")).toBe("unknown_status");
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

  it("未知の値 → info", () => {
    expect(getTenantStatusTone("unknown")).toBe("info");
  });
});

describe("getTenantRoleLabel", () => {
  it("tenant_admin → テナント管理者", () => {
    expect(getTenantRoleLabel("tenant_admin")).toBe("テナント管理者");
  });

  it("tenant_editor → 編集担当", () => {
    expect(getTenantRoleLabel("tenant_editor")).toBe("編集担当");
  });

  it("tenant_member → メンバー", () => {
    expect(getTenantRoleLabel("tenant_member")).toBe("メンバー");
  });

  it("tenant_owner → オーナー", () => {
    expect(getTenantRoleLabel("tenant_owner")).toBe("オーナー");
  });

  it("未知の値はそのまま返す", () => {
    expect(getTenantRoleLabel("custom_role")).toBe("custom_role");
  });
});
