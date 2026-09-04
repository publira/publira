// @vitest-environment jsdom

import { cleanup, render as renderBase, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleProvider } from "#components/admin-locale-context";

import { TenantTimezoneForm } from "./tenant-timezone-form";

vi.mock("next/navigation", () => ({
  useParams: () => ({ tenant_id: "TENANT001" }),
}));

const noopAction = vi.fn();

const render = (ui: ReactNode) =>
  renderBase(ui, {
    wrapper: ({ children }) => (
      <AdminLocaleProvider locale="en">{children}</AdminLocaleProvider>
    ),
  });

afterEach(() => {
  cleanup();
});

describe("TenantTimezoneForm", () => {
  it("shows the saved time zone as the selected one", () => {
    render(
      <TenantTimezoneForm
        action={noopAction}
        canEdit
        initialTimezone="America/Los_Angeles"
      />
    );

    const input = screen.getByLabelText<HTMLInputElement>("Time zone");

    expect(input.value).toBe("America/Los_Angeles");
    expect(input.disabled).toBe(false);
  });

  it("keeps a saved alias that is not enumerated as the selected one", () => {
    render(
      <TenantTimezoneForm
        action={noopAction}
        canEdit
        initialTimezone="Asia/Calcutta"
      />
    );

    expect(screen.getByLabelText<HTMLInputElement>("Time zone").value).toBe(
      "Asia/Calcutta"
    );
  });

  it("stays read-only for someone who is not a tenant admin", () => {
    render(
      <TenantTimezoneForm
        action={noopAction}
        canEdit={false}
        initialTimezone="Asia/Tokyo"
      />
    );

    expect(screen.getByLabelText<HTMLInputElement>("Time zone").disabled).toBe(
      true
    );
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Save the time zone",
      }).disabled
    ).toBe(true);
    expect(
      screen.getByText(
        "Only a tenant administrator can change this setting. You have read-only access."
      )
    ).toBeDefined();
  });

  it("shows the reason beside the field when the fetch fails", () => {
    render(
      <TenantTimezoneForm
        action={noopAction}
        canEdit
        initialTimezone="Asia/Tokyo"
        loadErrorMessage="Could not load the time zone."
      />
    );

    expect(screen.getByText("Could not load the time zone.")).toBeDefined();
  });
});
