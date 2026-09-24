// @vitest-environment jsdom

import { getLocales } from "@publira/i18n";
import { sharedCatalog, sharedMessage } from "@publira/i18n/catalog";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AdminLocaleProvider } from "#components/admin-locale-context";

import { auditActions } from "../_lib/audit-actions";
import { AuditActionSelect } from "./audit-action-select";

afterEach(() => {
  cleanup();
});

const actionLabel = (action: (typeof auditActions)[number]) =>
  sharedMessage(`admin.audit.actions.${action}`, "en");

const openOptionLabels = async () => {
  fireEvent.click(screen.getByRole("combobox"));

  return within(await screen.findByRole("listbox"))
    .getAllByRole("option")
    .map((option) => option.textContent);
};

describe("AuditActionSelect", () => {
  it("offers every action the filter accepts, each once", async () => {
    render(
      <AdminLocaleProvider locale="en" messages={sharedCatalog("en")}>
        <AuditActionSelect defaultValue="" />
      </AdminLocaleProvider>
    );

    expect(await openOptionLabels()).toEqual([
      sharedMessage("admin.audit.actions.all", "en"),
      ...auditActions.map(actionLabel),
    ]);
  });

  it("submits each action under the label that names it", () => {
    for (const action of auditActions) {
      const { container, unmount } = render(
        <AdminLocaleProvider locale="en" messages={sharedCatalog("en")}>
          <form>
            <AuditActionSelect defaultValue={action} />
          </form>
        </AdminLocaleProvider>
      );

      const form = container.querySelector("form");
      expect(form ? new FormData(form).get("action") : null).toBe(action);
      expect(screen.getByRole("combobox", { name: "Action" }).textContent).toBe(
        actionLabel(action)
      );
      unmount();
    }
  });

  it.each(getLocales())("names every action in %s", async (locale) => {
    render(
      <AdminLocaleProvider locale={locale} messages={sharedCatalog(locale)}>
        <AuditActionSelect defaultValue="" />
      </AdminLocaleProvider>
    );

    const labels = await openOptionLabels();

    expect(labels).not.toContain("");
    expect(new Set(labels).size).toBe(labels.length);
  });
});
