import { describe, expect, it } from "vitest";

import { getAuditActionLabel, getAuditActionOptions } from "./audit-log-labels";
import { loadPlatformMessages } from "./locale";

const en = await loadPlatformMessages("en");
const ja = await loadPlatformMessages("ja");

describe("audit-log-labels", () => {
  it("returns the label for known actions", () => {
    expect(getAuditActionLabel("operator_updated", en)).toBe(
      "Updated an operator"
    );
    expect(getAuditActionLabel("tenant_suspended", en)).toBe(
      "Suspended a tenant"
    );
    expect(getAuditActionLabel("platform_email_settings_updated", en)).toBe(
      "Updated SMTP settings"
    );
    expect(getAuditActionLabel("platform_smtp_test_email_sent", en)).toBe(
      "Sent an SMTP test email"
    );
    expect(getAuditActionLabel("platform_settings_updated", en)).toBe(
      "Updated platform settings"
    );
  });

  it("returns original action for unknown values", () => {
    expect(getAuditActionLabel("unknown_action", en)).toBe("unknown_action");
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
