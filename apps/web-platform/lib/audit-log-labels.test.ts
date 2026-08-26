import { describe, expect, it } from "vitest";

import { getAuditActionLabel, getAuditActionOptions } from "./audit-log-labels";
import { loadPlatformMessages } from "./locale";

const ja = await loadPlatformMessages("ja");
const en = await loadPlatformMessages("en");

describe("audit-log-labels", () => {
  it("returns Japanese label for known actions", () => {
    expect(getAuditActionLabel("operator_updated", ja)).toBe(
      "オペレーターを更新"
    );
    expect(getAuditActionLabel("tenant_suspended", ja)).toBe("テナントを停止");
    expect(getAuditActionLabel("platform_email_settings_updated", ja)).toBe(
      "SMTP設定を更新"
    );
    expect(getAuditActionLabel("platform_smtp_test_email_sent", ja)).toBe(
      "SMTP 接続テストメールを送信"
    );
    expect(getAuditActionLabel("platform_settings_updated", ja)).toBe(
      "プラットフォーム設定を更新"
    );
  });

  it("returns English labels when the catalog is en", () => {
    expect(getAuditActionLabel("operator_updated", en)).toBe(
      "Updated an operator"
    );
  });

  it("returns original action for unknown values", () => {
    expect(getAuditActionLabel("unknown_action", ja)).toBe("unknown_action");
  });

  it("sorts selectable options by the UI locale", () => {
    const jaOptions = getAuditActionOptions(ja, "ja");
    const enOptions = getAuditActionOptions(en, "en");

    expect(jaOptions.some((item) => item.value === "operator_created")).toBe(
      true
    );
    expect(enOptions.some((item) => item.value === "tenant_created")).toBe(
      true
    );
    expect(jaOptions.map((item) => item.label)).toEqual(
      jaOptions
        .map((item) => item.label)
        .toSorted((left, right) => left.localeCompare(right, "ja"))
    );
    expect(enOptions.map((item) => item.label)).toEqual(
      enOptions
        .map((item) => item.label)
        .toSorted((left, right) => left.localeCompare(right, "en"))
    );
  });
});
