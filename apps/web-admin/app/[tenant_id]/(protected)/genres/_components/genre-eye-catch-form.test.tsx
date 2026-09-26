// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import type { FormActionState } from "@publira/ui-components/action-form";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleProvider } from "#components/admin-locale-context";

import type { GenreListItem } from "../genre-types";
import { GenreEyeCatchForm } from "./genre-eye-catch-form";

const { save, submitted } = vi.hoisted(() => ({
  save: { current: Promise.withResolvers<FormActionState>() },
  submitted: { current: Promise.withResolvers<FormData>() },
}));

vi.mock("../_lib/actions", () => ({
  updateGenreEyeCatchAction: (_state: FormActionState, formData: FormData) => {
    submitted.current.resolve(formData);
    return save.current.promise;
  },
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

// The image field is a client control, which reads its own copy from the
// catalog the console layout provides.
const EnglishConsole = ({ children }: { children: ReactNode }) => (
  <AdminLocaleProvider locale="en" messages={sharedCatalog("en")}>
    {children}
  </AdminLocaleProvider>
);

const genre: GenreListItem = {
  eyeCatchImageUpdatedAt: "2026-09-26T00:00:00Z",
  eyeCatchImageVariants: [
    {
      contentType: "image/webp",
      fileSizeBytes: 1024,
      height: 1200,
      label: "square_1200w",
      url: "https://cdn.example.com/genres/GENRE001/square.webp",
      variantType: "square",
      width: 1200,
    },
  ],
  name: "Fantasy",
  publicId: "GENRE001",
  slug: "fantasy",
};

afterEach(() => {
  cleanup();
  save.current = Promise.withResolvers<FormActionState>();
  submitted.current = Promise.withResolvers<FormData>();
});

const imageControls = () => [
  screen.getByLabelText<HTMLInputElement>("Eye-catch image"),
  screen.getByRole<HTMLButtonElement>("button", { name: /square/u }),
  screen.getByRole<HTMLButtonElement>("button", {
    name: "Delete the current eye-catch image",
  }),
];

describe("GenreEyeCatchForm", () => {
  // The Action carries the image and the delete flag the form held when it was
  // submitted, so a change made while it is in flight would not be saved.
  it("closes the image controls while the save is in flight", async () => {
    render(<GenreEyeCatchForm genre={genre} tenantId="TENANT001" />, {
      wrapper: EnglishConsole,
    });

    for (const control of imageControls()) {
      expect(control.disabled).toBe(false);
    }

    fireEvent.click(screen.getByRole("button", { name: "Update cover image" }));

    await waitFor(() => {
      for (const control of imageControls()) {
        expect(control.disabled).toBe(true);
      }
    });

    save.current.resolve({ message: "Could not save.", ok: false });
    await waitFor(() => {
      for (const control of imageControls()) {
        expect(control.disabled).toBe(false);
      }
    });
  });

  // `UpdateGenre` takes the name beside the image, so the form sends back the
  // one it read rather than leaving the Action to guess it.
  it("posts the genre it edits, its name, and the delete flag", async () => {
    render(<GenreEyeCatchForm genre={genre} tenantId="TENANT001" />, {
      wrapper: EnglishConsole,
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Delete the current eye-catch image" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Update cover image" }));

    const formData = await submitted.current.promise;
    expect(formData.get("tenant_id")).toBe("TENANT001");
    expect(formData.get("public_id")).toBe("GENRE001");
    expect(formData.get("name")).toBe("Fantasy");
    expect(formData.get("clear_eye_catch_image")).toBe("1");
    expect(formData.get("current_eye_catch_image_updated_at")).toBe(
      "2026-09-26T00:00:00Z"
    );

    save.current.resolve({ message: "Cover image updated.", ok: true });
    expect(await screen.findByText("Cover image updated.")).toBeTruthy();
  });
});
