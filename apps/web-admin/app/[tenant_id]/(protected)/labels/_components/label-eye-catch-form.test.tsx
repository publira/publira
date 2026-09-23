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

import type { LabelActionState, LabelListItem } from "../label-types";
import { LabelEyeCatchForm } from "./label-eye-catch-form";

vi.mock("#lib/use-tenant-id", () => ({
  useTenantId: () => "TENANT001",
}));

const EnglishConsole = ({ children }: { children: ReactNode }) => (
  <AdminLocaleProvider locale="en" messages={sharedCatalog("en")}>
    {children}
  </AdminLocaleProvider>
);

const label: LabelListItem = {
  eyeCatchImageUpdatedAt: "2026-01-01T00:00:00Z",
  eyeCatchImageVariants: [
    {
      contentType: "image/webp",
      fileSizeBytes: 1024,
      height: 3200,
      label: "3:4 2400w",
      url: "https://cdn.example.com/labels/LABEL001/3x4.webp",
      variantType: "3:4",
      width: 2400,
    },
  ],
  name: "Monthly Novels",
  publicId: "LABEL001",
};

afterEach(() => {
  cleanup();
});

const submittedControls = () => [
  screen.getByLabelText<HTMLInputElement>("Eye-catch image"),
  screen.getByRole<HTMLButtonElement>("button", { name: /3:4/u }),
  screen.getByRole<HTMLButtonElement>("button", {
    name: "Delete the current eye-catch image",
  }),
];

describe("LabelEyeCatchForm", () => {
  // The Action carries the image and the delete flag the form held when it was
  // submitted, so a change made while it is in flight would not be saved.
  it("closes the image controls while the save is in flight", async () => {
    // Never resolved: the assertions are about the window the save is open in.
    const save = Promise.withResolvers<LabelActionState>();
    const pendingAction = vi.fn(() => save.promise);

    await act(() => {
      render(
        <LabelEyeCatchForm action={pendingAction} initialLabel={label} />,
        {
          wrapper: EnglishConsole,
        }
      );
    });

    for (const control of submittedControls()) {
      expect(control.disabled).toBe(false);
    }

    fireEvent.click(screen.getByRole("button", { name: "Update cover image" }));

    await waitFor(() => {
      for (const control of submittedControls()) {
        expect(control.disabled).toBe(true);
      }
    });
  });
});
