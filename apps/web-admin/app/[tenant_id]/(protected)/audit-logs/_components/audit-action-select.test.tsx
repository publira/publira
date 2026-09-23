// @vitest-environment jsdom

import { getLocales } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AdminLocaleProvider } from "#components/admin-locale-context";

import { auditActions } from "../_lib/audit-actions";
import { AuditActionSelect } from "./audit-action-select";

afterEach(() => {
  cleanup();
});

describe("AuditActionSelect", () => {
  it("offers every action the filter accepts, each once", () => {
    render(
      <AdminLocaleProvider locale="en" messages={sharedCatalog("en")}>
        <AuditActionSelect defaultValue="" />
      </AdminLocaleProvider>
    );

    const values = within(screen.getByLabelText("Action"))
      .getAllByRole("option")
      .map((option) => option.getAttribute("value"));

    expect(values).toEqual(["", ...auditActions]);
  });

  it("names every action in every locale", () => {
    for (const locale of getLocales()) {
      const messages = sharedCatalog(locale);
      const { unmount } = render(
        <AdminLocaleProvider locale={locale} messages={messages}>
          <AuditActionSelect defaultValue="" />
        </AdminLocaleProvider>
      );

      const labels = screen
        .getAllByRole("option")
        .map((option) => option.textContent);

      expect(labels).not.toContain("");
      expect(new Set(labels).size).toBe(labels.length);
      unmount();
    }
  });
});
