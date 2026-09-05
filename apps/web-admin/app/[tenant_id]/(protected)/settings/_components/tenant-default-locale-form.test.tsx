// @vitest-environment jsdom

import { cleanup, render as renderBase, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleProvider } from "#components/admin-locale-context";

import { TenantDefaultLocaleForm } from "./tenant-default-locale-form";

vi.mock("next/navigation", () => ({
  useParams: () => ({ tenant_id: "TENANT001" }),
}));

const noopAction = vi.fn();

// The labels are the autonyms `getLocaleLabel` returns, which are the same
// string in every locale — so Japanese is listed as 日本語 on an English
// console too.
const options = [
  { label: "日本語", locale: "ja" as const },
  { label: "English", locale: "en" as const },
];

const render = (ui: ReactNode) =>
  renderBase(ui, {
    wrapper: ({ children }) => (
      <AdminLocaleProvider locale="en">{children}</AdminLocaleProvider>
    ),
  });

afterEach(() => {
  cleanup();
});

describe("TenantDefaultLocaleForm", () => {
  it("shows the saved default locale as the selected one", () => {
    render(
      <TenantDefaultLocaleForm
        action={noopAction}
        canEdit
        initialDefaultLocale="en"
        options={options}
      />
    );

    const trigger = screen.getByLabelText("Default language");

    expect(trigger.textContent).toContain("English");
    expect(trigger).toHaveProperty("disabled", false);
  });

  it("stays read-only for someone who is not a tenant admin", () => {
    render(
      <TenantDefaultLocaleForm
        action={noopAction}
        canEdit={false}
        initialDefaultLocale="ja"
        options={options}
      />
    );

    expect(screen.getByLabelText("Default language")).toHaveProperty(
      "disabled",
      true
    );
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Save the default language",
      }).disabled
    ).toBe(true);
    expect(
      screen.getByText(
        "Only a tenant administrator can change this setting. You have read-only access."
      )
    ).toBeDefined();
  });

  it("blocks editing and shows the reason when the fetch fails", () => {
    render(
      <TenantDefaultLocaleForm
        action={noopAction}
        canEdit
        initialDefaultLocale="ja"
        loadErrorMessage="Could not load the default language."
        options={options}
      />
    );

    expect(screen.getByLabelText("Default language")).toHaveProperty(
      "disabled",
      true
    );
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Save the default language",
      }).disabled
    ).toBe(true);
    expect(
      screen.getByText(/Could not load the default language./u)
    ).toBeDefined();
    expect(
      screen.getByText(/Saving now would overwrite the stored setting/u)
    ).toBeDefined();
  });
});
