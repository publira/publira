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

import type { SeriesActionState, SeriesListItem } from "../series-types";
import { SeriesEyeCatchForm } from "./series-eye-catch-form";

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

const series: SeriesListItem = {
  ageRating: "all",
  availability: "all",
  creatorCredits: [],
  eyeCatchImageUpdatedAt: "2026-01-01T00:00:00Z",
  eyeCatchImageVariants: [
    {
      contentType: "image/webp",
      fileSizeBytes: 1024,
      height: 3200,
      label: "portrait_2400w",
      url: "https://cdn.example.com/series/SERIES001/3x4.webp",
      variantType: "portrait",
      width: 2400,
    },
  ],
  genreIds: [],
  id: "SERIES001-ID",
  isPublished: false,
  labelId: "LABEL001",
  labelName: "Label A",
  publicId: "SERIES001",
  publishedAt: "",
  readingPeriodHours: 72,
  scheduleWeekdays: [],
  status: "ongoing",
  synopsis: "A synopsis",
  tagNames: [],
  title: "Existing Series",
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

describe("SeriesEyeCatchForm", () => {
  // The Action carries the image and the delete flag the form held when it was
  // submitted, so a change made while it is in flight would not be saved.
  it("closes the image controls while the save is in flight", async () => {
    // Never resolved: the assertions are about the window the save is open in.
    const save = Promise.withResolvers<SeriesActionState>();

    await act(() => {
      render(
        <SeriesEyeCatchForm
          action={() => save.promise}
          series={series}
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
  });

  // The tab edits the image alone, so it states none of the listing fields
  // and the save keeps whatever the series holds for them.
  it("posts none of the listing fields", async () => {
    const submitted = Promise.withResolvers<FormData>();

    await act(() => {
      render(
        <SeriesEyeCatchForm
          action={(_state, formData) => {
            submitted.resolve(formData);
            return Promise.resolve(null);
          }}
          series={series}
          tenantId="TENANT001"
        />,
        { wrapper: EnglishConsole }
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Update cover image" }));

    const formData = await submitted.promise;
    expect(formData.get("title")).toBe("Existing Series");
    for (const name of [
      "synopsis",
      "reading_period_hours",
      "status",
      "schedule_weekdays",
      "age_rating",
      "comment_mode",
      "reading_direction",
      "spread_start_page",
    ]) {
      expect(formData.has(name)).toBe(false);
    }
  });
});
