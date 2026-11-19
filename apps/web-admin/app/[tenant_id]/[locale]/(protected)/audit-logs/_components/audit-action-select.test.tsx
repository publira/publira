// @vitest-environment jsdom

import { getLocales } from "@publira/i18n";
import { sharedMessage } from "@publira/i18n/catalog";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";

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
      <AdminLocaleTestProvider locale="en">
        <AuditActionSelect defaultValue="" />
      </AdminLocaleTestProvider>
    );

    expect(await openOptionLabels()).toEqual([
      sharedMessage("admin.audit.actions.all", "en"),
      ...auditActions.map(actionLabel),
    ]);
  });

  it.each(auditActions)(
    "submits %s under the label that names it",
    (action) => {
      const { container } = render(
        <AdminLocaleTestProvider locale="en">
          <form>
            <AuditActionSelect defaultValue={action} />
          </form>
        </AdminLocaleTestProvider>
      );

      const form = container.querySelector("form");
      expect(form ? new FormData(form).get("action") : null).toBe(action);
      expect(screen.getByRole("combobox", { name: "Action" }).textContent).toBe(
        actionLabel(action)
      );
    }
  );

  it.each(getLocales())("names every action in %s", async (locale) => {
    render(
      <AdminLocaleTestProvider locale={locale}>
        <AuditActionSelect defaultValue="" />
      </AdminLocaleTestProvider>
    );

    const labels = await openOptionLabels();

    expect(labels).not.toContain("");
    expect(new Set(labels).size).toBe(labels.length);
  });
});
