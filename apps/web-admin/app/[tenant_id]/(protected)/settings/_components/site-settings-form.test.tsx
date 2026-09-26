// @vitest-environment jsdom

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

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";

import type { SiteSettingsActionState } from "../settings-types";
import { SiteSettingsForm } from "./site-settings-form";

vi.mock("next/navigation", () => ({
  useParams: () => ({ tenant_id: "TENANT001" }),
}));

const EnglishConsole = ({ children }: { children: ReactNode }) => (
  <AdminLocaleTestProvider locale="en">{children}</AdminLocaleTestProvider>
);

const fields = () => [
  screen.getByRole<HTMLInputElement>("textbox", { name: "Copyright notice" }),
  screen.getByRole<HTMLInputElement>("textbox", { name: "Site tagline" }),
  screen.getByRole<HTMLTextAreaElement>("textbox", {
    name: "Site description",
  }),
];

afterEach(() => {
  cleanup();
});

describe("SiteSettingsForm", () => {
  // The Action carries what the fields held when the form was submitted, so an
  // edit made while it is in flight would sit under the success message unsaved.
  it("closes the fields while the save is in flight", async () => {
    // Never resolved: the assertions are about the window the save is open in.
    const save = Promise.withResolvers<SiteSettingsActionState>();
    const pendingAction = vi.fn(() => save.promise);

    await act(() => {
      render(
        <SiteSettingsForm
          action={pendingAction}
          initialSettings={{
            copyrightText: "Copyright © 2026 Acme Inc.",
            siteDescription: "News and release announcements.",
            siteTagline: "Read quietly",
          }}
        />,
        { wrapper: EnglishConsole }
      );
    });

    for (const field of fields()) {
      expect(field.disabled).toBe(false);
    }

    fireEvent.click(
      await screen.findByRole("button", { name: "Save the settings" })
    );

    await waitFor(() => {
      for (const field of fields()) {
        expect(field.disabled).toBe(true);
      }
    });
  });
});
