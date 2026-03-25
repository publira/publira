import { describe, expect, it } from "vitest";

import { auditActionOptions, getAuditActionLabel } from "./audit-log-labels";

describe("audit-log-labels", () => {
  it("returns Japanese label for known actions", () => {
    expect(getAuditActionLabel("episode_created")).toBe("エピソードを作成");
    expect(getAuditActionLabel("episode_image_uploaded")).toBe(
      "エピソード画像をアップロード"
    );
    expect(getAuditActionLabel("tenant_suspended")).toBe("テナントを停止");
  });

  it("returns original action for unknown values", () => {
    expect(getAuditActionLabel("unknown_action")).toBe("unknown_action");
  });

  it("exposes selectable audit action options", () => {
    expect(
      auditActionOptions.some((item) => item.value === "episode_created")
    ).toBe(true);
    expect(
      auditActionOptions.some((item) => item.value === "episode_image_uploaded")
    ).toBe(true);
  });
});
