// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";

import { EpisodePreview } from "./episode-preview";

afterEach(() => {
  cleanup();
});

const pages = [
  { id: "page-1", src: "https://example.test/1.avif", title: "Pilot, page 1" },
  { id: "page-2", src: "https://example.test/2.avif", title: "Pilot, page 2" },
  { id: "page-3", src: "https://example.test/3.avif", title: "Pilot, page 3" },
  { id: "page-4", src: "https://example.test/4.avif", title: "Pilot, page 4" },
];

const renderPreview = (props: Parameters<typeof EpisodePreview>[0]) =>
  render(
    <AdminLocaleTestProvider locale="en">
      <EpisodePreview {...props} />
    </AdminLocaleTestProvider>
  );

/** Press the viewer the way a keyboard does, which shows its controls. */
const pressViewer = () => {
  fireEvent.keyDown(screen.getByRole("button", { name: /^Pilot, page/u }), {
    key: "Enter",
  });
};

const pageStatus = () => screen.getByText(/^Pages? \d/u);

describe("EpisodePreview", () => {
  it("turns the pages in the episode's reading direction", () => {
    renderPreview({
      layout: { readingDirection: "ltr", spreadStartIndex: 1 },
      pages,
    });

    expect(
      screen.getByRole("button", { name: /Pilot, page 1/u }).dataset
        .readingDirection
    ).toBe("ltr");
  });

  it("shows the first page alone where spreads start from the second", () => {
    renderPreview({
      layout: { readingDirection: "rtl", spreadStartIndex: 1 },
      pages,
    });
    pressViewer();

    expect(pageStatus().textContent).toBe("Page 1 of 4");

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));

    expect(pageStatus().textContent).toBe("Pages 2–3 of 4");
  });

  it("pairs the first page with the second where spreads start from it", () => {
    renderPreview({
      layout: { readingDirection: "rtl", spreadStartIndex: 0 },
      pages,
    });
    pressViewer();

    expect(pageStatus().textContent).toBe("Pages 1–2 of 4");
    expect(
      screen
        .getByRole("slider", { name: "Reading progress" })
        .getAttribute("aria-valuetext")
    ).toBe("Pages 1–2 of 4");
  });

  it("says an episode with no pages has none rather than showing a bare mat", () => {
    renderPreview({
      layout: { readingDirection: "rtl", spreadStartIndex: 1 },
      pages: [],
    });

    expect(
      screen.getByText(
        "This episode has no pages yet. Add page images to preview them."
      )
    ).toBeDefined();
  });
});
