import { describe, expect, it } from "vitest";

import { getAuditActionLabel, getAuditActionOptions } from "./audit-log-labels";

const en = "en" as const;
const ja = "ja" as const;

describe("audit-log-labels", () => {
  it("returns the label for known actions", async () => {
    await expect(getAuditActionLabel("operator_updated", en)).resolves.toBe(
      "Updated an operator"
    );
    await expect(getAuditActionLabel("tenant_suspended", en)).resolves.toBe(
      "Suspended a tenant"
    );
    await expect(
      getAuditActionLabel("platform_email_settings_updated", en)
    ).resolves.toBe("Updated SMTP settings");
    await expect(
      getAuditActionLabel("platform_smtp_test_email_sent", en)
    ).resolves.toBe("Sent an SMTP test email");
    await expect(
      getAuditActionLabel("platform_settings_updated", en)
    ).resolves.toBe("Updated platform settings");
    await expect(
      getAuditActionLabel("platform_storage_settings_updated", en)
    ).resolves.toBe("Updated storage settings");
    await expect(
      getAuditActionLabel("platform_storage_connection_tested", en)
    ).resolves.toBe("Tested the storage connection");
  });

  it("offers the storage actions in the action filter", async () => {
    const options = await getAuditActionOptions(en);

    expect(options).toContainEqual({
      label: "Updated storage settings",
      value: "platform_storage_settings_updated",
    });
    expect(options).toContainEqual({
      label: "Tested the storage connection",
      value: "platform_storage_connection_tested",
    });
  });

  it("returns original action for unknown values", async () => {
    await expect(getAuditActionLabel("unknown_action", en)).resolves.toBe(
      "unknown_action"
    );
  });

  it("sorts selectable options by the UI locale", async () => {
    const [jaOptions, enOptions] = await Promise.all([
      getAuditActionOptions(ja),
      getAuditActionOptions(en),
    ]);

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
