// @vitest-environment jsdom

import { sharedCatalog } from "@publira/i18n/catalog";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleProvider } from "#components/admin-locale-context";

import type { CreateAnnouncementActionState } from "../announcement-types";
import { AnnouncementForm } from "./announcement-form";

vi.mock("#lib/use-tenant-id", () => ({
  useTenantId: () => "TENANT001",
}));

const EnglishConsole = ({ children }: { children: ReactNode }) => (
  <AdminLocaleProvider locale="en" messages={sharedCatalog("en")}>
    {children}
  </AdminLocaleProvider>
);

/**
 * Whether a control refuses input, whichever way it says so. A native control
 * its `<fieldset>` closes keeps `disabled` false and matches `:disabled`, and
 * the banner checkbox is a Base UI one that says so with `aria-disabled`.
 */
const isClosed = (element: HTMLElement) =>
  element.matches(":disabled") ||
  element.getAttribute("aria-disabled") === "true";

afterEach(() => {
  cleanup();
});

const submittedControls = () => [
  screen.getByRole("textbox", { name: /Title/u }),
  screen.getByRole("textbox", { name: /Body/u }),
  screen.getByRole("textbox", { name: "Link" }),
  screen.getByRole("radio", { name: "Everyone" }),
  screen.getByRole("radio", { name: "Selected users" }),
  screen.getByRole("checkbox", { name: "Show as a site banner" }),
];

describe("AnnouncementForm", () => {
  // The Action carries what the form held when it was submitted, so a change
  // made while it is in flight would not be the announcement that goes out.
  it("closes every field while the delivery is in flight", async () => {
    // Never resolved: the assertions are about the window the save is open in.
    const delivery = Promise.withResolvers<CreateAnnouncementActionState>();
    const pendingAction = vi.fn(() => delivery.promise);

    await act(() => {
      render(
        <AnnouncementForm
          action={pendingAction}
          timeZone="UTC"
          users={[{ name: "Reader A", publicId: "USER001" }]}
        />,
        { wrapper: EnglishConsole }
      );
    });

    fireEvent.change(screen.getByRole("textbox", { name: /Title/u }), {
      target: { value: "Maintenance tonight" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /Body/u }), {
      target: { value: "The site is down from 22:00 to 23:00 UTC." },
    });

    for (const control of submittedControls()) {
      expect(isClosed(control)).toBe(false);
    }

    fireEvent.click(
      screen.getByRole("button", { name: "Deliver the announcement" })
    );

    await waitFor(() => {
      for (const control of submittedControls()) {
        expect(isClosed(control)).toBe(true);
      }
    });
  });
});
