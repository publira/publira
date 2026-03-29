import { describe, expect, it } from "vitest";

import { auditActionOptions, getAuditActionLabel } from "./audit-log-labels";

describe("audit-log-labels", () => {
  it("returns Japanese label for known actions", () => {
    expect(getAuditActionLabel("operator_updated")).toBe("オペレーターを更新");
    expect(getAuditActionLabel("tenant_suspended")).toBe("テナントを停止");
    expect(getAuditActionLabel("platform_email_settings_updated")).toBe(
      "SMTP設定を更新"
    );
    expect(getAuditActionLabel("platform_smtp_test_email_sent")).toBe(
      "SMTP 接続テストメールを送信"
    );
  });

  it("returns original action for unknown values", () => {
    expect(getAuditActionLabel("unknown_action")).toBe("unknown_action");
  });

  it("exposes selectable audit action options", () => {
    expect(
      auditActionOptions.some((item) => item.value === "operator_created")
    ).toBe(true);
    expect(
      auditActionOptions.some((item) => item.value === "tenant_created")
    ).toBe(true);
    expect(
      auditActionOptions.some(
        (item) => item.value === "platform_email_settings_updated"
      )
    ).toBe(true);
    expect(
      auditActionOptions.some(
        (item) => item.value === "platform_smtp_test_email_sent"
      )
    ).toBe(true);
  });
});
