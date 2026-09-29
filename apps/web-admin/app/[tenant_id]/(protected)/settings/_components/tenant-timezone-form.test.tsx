// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import {
  cleanup,
  fireEvent,
  render as renderBase,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";

import type { TenantTimezoneActionState } from "../settings-types";
import { TenantTimezoneForm } from "./tenant-timezone-form";

const { save } = vi.hoisted(() => ({
  save: { current: Promise.withResolvers<TenantTimezoneActionState>() },
}));

vi.mock("../_lib/actions", () => ({
  updateTenantTimezoneAction: () => save.current.promise,
}));

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"))(message, values),
}));

const render = (ui: ReactNode) =>
  renderBase(ui, {
    wrapper: ({ children }) => (
      <AdminLocaleTestProvider locale="en">{children}</AdminLocaleTestProvider>
    ),
  });

afterEach(() => {
  cleanup();
  save.current = Promise.withResolvers<TenantTimezoneActionState>();
});

describe("TenantTimezoneForm", () => {
  it("shows the saved time zone as the selected one", () => {
    render(
      <TenantTimezoneForm
        canEdit
        initialTimezone="America/Los_Angeles"
        tenantId="TENANT001"
      />
    );

    const input = screen.getByLabelText<HTMLInputElement>("Time zone");

    expect(input.value).toBe("America/Los_Angeles");
    expect(input.matches(":disabled")).toBe(false);
  });

  it("keeps a saved alias that is not enumerated as the selected one", () => {
    render(
      <TenantTimezoneForm
        canEdit
        initialTimezone="Asia/Calcutta"
        tenantId="TENANT001"
      />
    );

    expect(screen.getByLabelText<HTMLInputElement>("Time zone").value).toBe(
      "Asia/Calcutta"
    );
  });

  it("stays read-only for someone who is not a tenant admin", () => {
    render(
      <TenantTimezoneForm
        canEdit={false}
        initialTimezone="UTC"
        tenantId="TENANT001"
      />
    );

    expect(
      screen.getByLabelText<HTMLInputElement>("Time zone").matches(":disabled")
    ).toBe(true);
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
        canEdit
        initialTimezone="UTC"
        loadErrorMessage="Could not load the time zone."
        tenantId="TENANT001"
      />
    );

    expect(screen.getByText("Could not load the time zone.")).toBeDefined();
  });

  // The Action carries the zone picked when the form was submitted, so a pick
  // made while it is in flight would sit under the success message unsaved.
  it("closes the picker while the save is in flight", async () => {
    render(
      <TenantTimezoneForm canEdit initialTimezone="UTC" tenantId="TENANT001" />
    );

    const input = screen.getByLabelText<HTMLInputElement>("Time zone");

    expect(input.matches(":disabled")).toBe(false);

    fireEvent.click(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Save the time zone",
      })
    );

    await waitFor(() => {
      expect(input.matches(":disabled")).toBe(true);
    });

    save.current.resolve({
      message: "The time zone was saved.",
      ok: true,
    });
    expect(await screen.findByText("The time zone was saved.")).toBeDefined();
    expect(input.matches(":disabled")).toBe(false);
  });
});
