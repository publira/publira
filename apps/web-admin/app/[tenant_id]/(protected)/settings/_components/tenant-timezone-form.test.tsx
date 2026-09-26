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

vi.mock("#components/client-message", () => ({
  ClientMessage: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"))(message, values),
  useClientMessages: () => bindMessages(sharedCatalog("en")),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ tenant_id: "TENANT001" }),
}));

const noopAction = vi.fn();

const render = (ui: ReactNode) =>
  renderBase(ui, {
    wrapper: ({ children }) => (
      <AdminLocaleTestProvider locale="en">{children}</AdminLocaleTestProvider>
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
        initialTimezone="UTC"
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
        initialTimezone="UTC"
        loadErrorMessage="Could not load the time zone."
      />
    );

    expect(screen.getByText("Could not load the time zone.")).toBeDefined();
  });

  // The Action carries the zone picked when the form was submitted, so a pick
  // made while it is in flight would sit under the success message unsaved.
  it("closes the picker while the save is in flight", async () => {
    // Never resolved: the assertions are about the window the save is open in.
    const save = Promise.withResolvers<TenantTimezoneActionState>();
    const pendingAction = vi.fn(() => save.promise);

    render(
      <TenantTimezoneForm
        action={pendingAction}
        canEdit
        initialTimezone="UTC"
      />
    );

    const input = screen.getByLabelText<HTMLInputElement>("Time zone");

    expect(input.disabled).toBe(false);

    fireEvent.click(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Save the time zone",
      })
    );

    await waitFor(() => {
      expect(input.disabled).toBe(true);
    });
  });
});
