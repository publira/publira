import { getLocales } from "@publira/i18n";
import { describe, expect, it } from "vitest";

import { getAuditActionOptions } from "./audit-log-labels";

const en = "en" as const;
const ja = "ja" as const;

describe("getAuditActionOptions", () => {
  it.each([
    ["platform_storage_settings_updated", "Updated storage settings"],
    ["platform_storage_connection_tested", "Tested the storage connection"],
    ["platform_webpush_subject_updated", "Updated the Web Push contact"],
    ["tenant_admin_invite_canceled", "Canceled a tenant admin invitation"],
    ["tenant_admin_invite_resent", "Resent a tenant admin invitation"],
    ["tenant_admin_invited", "Invited a tenant admin"],
    ["tenant_member_added", "Added a tenant member"],
    ["tenant_member_created", "Created a tenant member account"],
    ["tenant_member_removed", "Removed a tenant member"],
    ["tenant_member_role_updated", "Changed a tenant member's role"],
  ])("offers %s in the action filter", async (value, label) => {
    const options = await getAuditActionOptions(en);

    expect(options).toContainEqual({ label, value });
  });

  it.each(getLocales())("words every option in %s", async (locale) => {
    const options = await getAuditActionOptions(locale);

    for (const { label, value } of options) {
      expect(label).not.toContain(value);
    }
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
