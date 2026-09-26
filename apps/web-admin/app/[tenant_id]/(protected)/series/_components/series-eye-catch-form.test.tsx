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

import type { SeriesActionState, SeriesListItem } from "../series-types";
import { SeriesEyeCatchForm } from "./series-eye-catch-form";

vi.mock("#lib/use-tenant-id", () => ({
  useTenantId: () => "TENANT001",
}));

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
      label: "3:4 2400w",
      url: "https://cdn.example.com/series/SERIES001/3x4.webp",
      variantType: "3:4",
      width: 2400,
    },
  ],
  genrePublicIds: [],
  isPublished: false,
  labelName: "Label A",
  labelPublicId: "LABEL001",
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
  screen.getByLabelText<HTMLInputElement>("Eye-catch image"),
  screen.getByRole<HTMLButtonElement>("button", { name: /3:4/u }),
  screen.getByRole<HTMLButtonElement>("button", {
    name: "Delete the current eye-catch image",
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
          initialSeries={series}
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
          initialSeries={series}
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
