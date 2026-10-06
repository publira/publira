// @vitest-environment jsdom

import { bindMessages, getLocales } from "@publira/i18n";
import type { Locale, MessageKey } from "@publira/i18n";
import { sharedCatalog, sharedMessage } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuditLogActionCell } from "./audit-log-cells";

const messageLocale = vi.hoisted(() => ({ current: "en" as Locale }));

vi.mock("#components/message", () => ({
  Message: ({ message }: { message: MessageKey<SharedMessages> }) =>
    bindMessages(sharedCatalog(messageLocale.current))(message),
}));

afterEach(() => {
  cleanup();
});

const renderActionCell = async (
  locale: Locale,
  action: string,
  targetType: string,
  targetId: string
) => {
  messageLocale.current = locale;

  render(
    <table>
      <tbody>
        <tr>
          {await AuditLogActionCell({
            action,
            locale,
            reason: "",
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
});
