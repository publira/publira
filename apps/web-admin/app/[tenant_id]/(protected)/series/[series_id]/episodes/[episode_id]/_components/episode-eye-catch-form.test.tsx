// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
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

import type { EpisodeEditActionState } from "../episode-edit-types";
import { EpisodeEyeCatchForm } from "./episode-eye-catch-form";

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"), "en")(message, values),
}));

// The image field is a client control, which reads its own copy from the
// catalog the console layout provides.
const EnglishConsole = ({ children }: { children: ReactNode }) => (
  <AdminLocaleTestProvider locale="en">{children}</AdminLocaleTestProvider>
);

const episode = {
  eyeCatchImageUpdatedAt: "2026-01-01T00:00:00Z",
  eyeCatchImageVariants: [
    {
      contentType: "image/webp",
      fileSizeBytes: 1024,
      height: 3200,
      label: "portrait_2400w",
      url: "https://cdn.example.com/episodes/EP001/3x4.webp",
      variantType: "portrait",
      width: 2400,
    },
  ],
  id: "episode-1",
};

afterEach(() => {
  cleanup();
});

const submittedControls = () => [
  screen.getByLabelText<HTMLInputElement>("Cover image"),
  screen.getByRole<HTMLButtonElement>("button", { name: /Portrait \(3:4\)/u }),
  screen.getByRole<HTMLButtonElement>("button", {
    name: "Delete the current cover image",
  }),
];

describe("EpisodeEyeCatchForm", () => {
  it("shows the variants the episode has stored", async () => {
    await act(() => {
      render(
        <EpisodeEyeCatchForm
          action={vi.fn()}
          episode={episode}
          tenantId="TENANT001"
        />,
        { wrapper: EnglishConsole }
      );
    });

    expect(
      screen
        .getAllByRole<HTMLImageElement>("img")
        .some((image) => image.src === episode.eyeCatchImageVariants[0]?.url)
    ).toBe(true);
  });

  // The Action carries the image and the delete flag the form held when it was
  // submitted, so a change made while it is in flight would not be saved.
  it("closes the image controls while the save is in flight", async () => {
    // Never resolved: the assertions are about the window the save is open in.
    const save = Promise.withResolvers<EpisodeEditActionState>();
    const pendingAction = vi.fn(() => save.promise);

    await act(() => {
      render(
        <EpisodeEyeCatchForm
          action={pendingAction}
          episode={episode}
          tenantId="TENANT001"
        />,
        { wrapper: EnglishConsole }
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
    const [, formData] = pendingAction.mock.calls[0] as unknown as [
      EpisodeEditActionState,
      FormData,
    ];
    expect(formData.get("tenant_id")).toBe("TENANT001");
    expect(formData.get("episode_id")).toBe("episode-1");
    expect(formData.get("current_eye_catch_image_updated_at")).toBe(
      "2026-01-01T00:00:00Z"
    );
  });

  it("sends the delete toggle when the editor removes the eye-catch", async () => {
    const save = Promise.withResolvers<EpisodeEditActionState>();
    const pendingAction = vi.fn(() => save.promise);

    await act(() => {
      render(
        <EpisodeEyeCatchForm
          action={pendingAction}
          episode={episode}
          tenantId="TENANT001"
        />,
        { wrapper: EnglishConsole }
      );
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Delete the current cover image" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Update cover image" }));

    await waitFor(() => {
      expect(pendingAction).toHaveBeenCalled();
    });
    const [, formData] = pendingAction.mock.calls[0] as unknown as [
      EpisodeEditActionState,
      FormData,
    ];
    expect(formData.get("clear_eye_catch_image")).toBe("1");
  });
});
