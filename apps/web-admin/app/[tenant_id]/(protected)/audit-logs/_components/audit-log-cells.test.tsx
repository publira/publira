// @vitest-environment jsdom

import { bindMessages, getLocaleLabel, getLocales } from "@publira/i18n";
import type { Locale, MessageKey } from "@publira/i18n";
import { sharedCatalog, sharedMessage } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuditLogActionCell } from "./audit-log-cells";

const messageLocale = vi.hoisted(() => ({ current: "en" as Locale }));

vi.mock("#components/message", () => ({
  Message: ({ message }: { message: MessageKey<SharedMessages> }) =>
    bindMessages(
      sharedCatalog(messageLocale.current),
      messageLocale.current
    )(message),
}));

afterEach(() => {
  cleanup();
});

const renderActionCell = async (
  locale: Locale,
  action: string,
  targetType: string,
  targetId: string,
  reason = ""
) => {
  messageLocale.current = locale;

  render(
    <table>
      <tbody>
        <tr>
          {await AuditLogActionCell({
            action,
            locale,
            reason,
            targetId,
            targetType,
          })}
        </tr>
      </tbody>
    </table>
  );

  return screen.getByRole("cell");
};

describe("AuditLogActionCell", () => {
  const targetId = "CREATOR001/USER001";

  it.each(
    getLocales().flatMap((locale) =>
      (["creator_account_linked", "creator_account_unlinked"] as const).map(
        (action) => [locale, action] as const
      )
    )
  )(
    "names a creator account entry and its target in %s: %s",
    async (locale, action) => {
      const cell = await renderActionCell(
        locale,
        action,
        "creator_account",
        targetId
      );

      const actionName = sharedMessage(`admin.audit.actions.${action}`, locale);
      const targetName = sharedMessage(
        "admin.audit.targets.creator_account",
        locale
      );

      expect(cell.textContent).toBe(`${actionName}${targetName} / ${targetId}`);
      expect(cell.textContent).not.toContain(
        sharedMessage("admin.audit.actions.other", locale)
      );
    }
  );

  it.each(getLocales())(
    "names a change to a series' wait-for-free rule in %s",
    async (locale) => {
      const cell = await renderActionCell(
        locale,
        "series_wait_free_settings_updated",
        "series",
        "SERIES001"
      );

      const actionName = sharedMessage(
        "admin.audit.actions.series_wait_free_settings_updated",
        locale
      );
      const targetName = sharedMessage("admin.audit.targets.series", locale);

      expect(cell.textContent).toBe(`${actionName}${targetName} / SERIES001`);
    }
  );

  it.each(getLocales())(
    "names a change to the inbound email settings in %s",
    async (locale) => {
      const cell = await renderActionCell(
        locale,
        "tenant_inbound_email_settings_updated",
        "inbound_email_config",
        "TENANT001"
      );

      const actionName = sharedMessage(
        "admin.audit.actions.tenant_inbound_email_settings_updated",
        locale
      );
      const targetName = sharedMessage(
        "admin.audit.targets.inbound_email_config",
        locale
      );

      expect(cell.textContent).toBe(`${actionName}${targetName} / TENANT001`);
    }
  );

  it.each(getLocales())(
    "names a change to the Google tag in %s",
    async (locale) => {
      const cell = await renderActionCell(
        locale,
        "tenant_analytics_settings_updated",
        "tenant_analytics_settings",
        "TENANT001"
      );

      const actionName = sharedMessage(
        "admin.audit.actions.tenant_analytics_settings_updated",
        locale
      );
      const targetName = sharedMessage(
        "admin.audit.targets.tenant_analytics_settings",
        locale
      );

      expect(cell.textContent).toBe(`${actionName}${targetName} / TENANT001`);
    }
  );

  it.each(getLocales())(
    "names a change to the refused email addresses in %s",
    async (locale) => {
      const cell = await renderActionCell(
        locale,
        "tenant_email_rejection_settings_updated",
        "tenant_email_rejection_settings",
        "TENANT001"
      );

      const actionName = sharedMessage(
        "admin.audit.actions.tenant_email_rejection_settings_updated",
        locale
      );
      const targetName = sharedMessage(
        "admin.audit.targets.tenant_email_rejection_settings",
        locale
      );

      expect(cell.textContent).toBe(`${actionName}${targetName} / TENANT001`);
    }
  );

  it.each(
    getLocales().flatMap((locale) =>
      (["preferred", "everyone"] as const).map(
        (delivery) => [locale, delivery] as const
      )
    )
  )(
    "names who a posted announcement's notification was for in %s: %s",
    async (locale, delivery) => {
      const cell = await renderActionCell(
        locale,
        "announcement_created",
        "announcement",
        "ANNOUNCEMENT001",
        `delivery=${delivery}`
      );

      const label = sharedMessage(
        `admin.audit.reasons.announcement_delivery.${delivery}`,
        locale
      );

      expect(cell.textContent).toContain(` / ${label}`);
      expect(cell.textContent).not.toContain("delivery=");
    }
  );

  it("falls back to the raw target type it has no name for", async () => {
    const cell = await renderActionCell(
      "en",
      "unrecorded_action",
      "unrecorded_target",
      targetId
    );

    expect(cell.textContent).toBe(
      `${sharedMessage("admin.audit.actions.other", "en")}unrecorded_target / ${targetId}`
    );
  });

  it.each(
    getLocales().flatMap((locale) =>
      (["en", "ja"] as const).map((copyLocale) => [locale, copyLocale] as const)
    )
  )(
    "names the language of a public site display save in %s: %s",
    async (locale, copyLocale) => {
      const cell = await renderActionCell(
        locale,
        "tenant_site_copy_updated",
        "tenant_site_copy",
        copyLocale
      );

      const actionName = sharedMessage(
        "admin.audit.actions.tenant_site_copy_updated",
        locale
      );
      const targetName = sharedMessage(
        "admin.audit.targets.tenant_site_copy",
        locale
      );
      const language = screen.getByText(getLocaleLabel(copyLocale));

      expect(cell.textContent).toBe(
        `${actionName}${targetName} / ${getLocaleLabel(copyLocale)}`
      );
      expect(language.getAttribute("lang")).toBe(copyLocale);
    }
  );

  it("keeps the tenant ID of a public site display save recorded before the language was", async () => {
    const cell = await renderActionCell(
      "en",
      "tenant_site_copy_updated",
      "tenant_site_copy",
      "TENANT001"
    );

    expect(cell.textContent).toBe(
      "Public site display updatedPublic site display / TENANT001"
    );
  });
});
