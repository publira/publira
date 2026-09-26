// @vitest-environment jsdom

import { useViewerContext } from "@publira/comic-viewer";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithClientMessages } from "#lib/render-with-client-messages";

import { EpisodeComicViewer } from "./episode-comic-viewer";

vi.mock("#components/locale-provider", () => ({
  useLocale: () => "en",
  useTenantDefaultLocale: () => "en",
}));

vi.mock("next/link", () => ({
  default: ({ children, className, href }: React.ComponentProps<"a">) => (
    <a className={className} href={href}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

const pages = [
  { id: "page-1", src: "https://example.test/1.avif", title: "Page 1" },
  { id: "page-2", src: "https://example.test/2.avif", title: "Page 2" },
  { id: "page-3", src: "https://example.test/3.avif", title: "Page 3" },
  { id: "page-4", src: "https://example.test/4.avif", title: "Page 4" },
];

const LayoutProbe = () => {
  const { readingDirection, spreadStartIndex } = useViewerContext();

  return <p>{`${readingDirection}:${spreadStartIndex}`}</p>;
};

describe("EpisodeComicViewer", () => {
  it("turns a left-to-right episode left to right", async () => {
    await renderWithClientMessages(
      <EpisodeComicViewer
        pages={pages}
        readingDirection="ltr"
        spreadStartIndex={1}
        wideViewerEnabled={false}
      >
        <LayoutProbe />
      </EpisodeComicViewer>
    );

    expect(screen.getByText("ltr:1")).toBeDefined();
    expect(
      screen.getByRole("button", { name: /Page 1/u }).dataset.readingDirection
    ).toBe("ltr");
  });

  it("pairs from the first page when the episode says so", async () => {
    await renderWithClientMessages(
      <EpisodeComicViewer
        pages={pages}
        readingDirection="rtl"
        spreadStartIndex={0}
        wideViewerEnabled={false}
      >
        <LayoutProbe />
      </EpisodeComicViewer>
    );

    expect(screen.getByText("rtl:0")).toBeDefined();
  });
});

const wideViewerMarker = (container: HTMLElement) =>
  container.querySelector<HTMLElement>("[data-wide-viewer]");

/** Press the viewer the way a keyboard does, which shows or hides its controls. */
const pressViewer = () => {
  fireEvent.keyDown(screen.getByRole("button", { name: /Page 1/u }), {
    key: "Enter",
  });
};

describe("EpisodeComicViewer rail", () => {
  it("animates the track only while a turn is under way, and zooms the current slot alone", async () => {
    const { container } = await renderWithClientMessages(
      <EpisodeComicViewer
        pages={pages}
        readingDirection="rtl"
        spreadStartIndex={1}
        wideViewerEnabled={false}
      />
    );

    // The library returns the track to its resting transform once a turn has
    // settled. A transition that is not limited to the turn animates that
    // return as well, so the reader sees the new spread slide in twice.
    const track = container.querySelector(".pcv-viewport-track");
    expect(track?.className).toContain(
      "data-[transition-state=active]:transition-transform"
    );
    expect(track?.className).not.toMatch(
      /(?:^|\s)transition-transform(?:\s|$)/u
    );

    const pageSet = container.querySelector(".pcv-viewport-page-set");
    expect(pageSet?.className).toContain(
      "data-[rail-slot=current]:[transform:"
    );
    expect(pageSet?.className).not.toMatch(/(?:^|\s)\[transform:/u);
  });
});

describe("EpisodeComicViewer wide viewer", () => {
  it("widens on the control, marks itself, and hands the choice to the server", async () => {
    const saveWideViewer = vi.fn(() => Promise.resolve());
    const { container } = await renderWithClientMessages(
      <EpisodeComicViewer
        pages={pages}
        readingDirection="rtl"
        saveWideViewer={saveWideViewer}
        spreadStartIndex={1}
        wideViewerEnabled={false}
      />
    );

    expect(wideViewerMarker(container)).toBeNull();

    pressViewer();
    fireEvent.click(
      screen.getByRole("button", { name: "Widen to the window" })
    );

    // The controls the reader just used are still shown, and so is the header.
    expect(wideViewerMarker(container)?.dataset.wideViewer).toBe("revealed");
    expect(
      screen
        .getByRole("button", { name: "Restore the page width" })
        .getAttribute("aria-pressed")
    ).toBe("true");
    expect(window.sessionStorage.getItem("publira.wide-viewer")).toBe("true");
    expect(saveWideViewer).toHaveBeenCalledWith(true);
  });

  it("brings the header back with the reader controls when the viewer is pressed", async () => {
    const { container } = await renderWithClientMessages(
      <EpisodeComicViewer
        pages={pages}
        readingDirection="rtl"
        spreadStartIndex={1}
        wideViewerEnabled
      />
    );

    // The reader controls start hidden, so the header starts retracted.
    expect(wideViewerMarker(container)?.dataset.wideViewer).toBe("retracted");

    pressViewer();
    expect(wideViewerMarker(container)?.dataset.wideViewer).toBe("revealed");

    pressViewer();
    expect(wideViewerMarker(container)?.dataset.wideViewer).toBe("retracted");
  });

  it("restores the width, and keeps a guest's choice in the browser alone", async () => {
    const { container } = await renderWithClientMessages(
      <EpisodeComicViewer
        pages={pages}
        readingDirection="rtl"
        spreadStartIndex={1}
        wideViewerEnabled
      />
    );

    pressViewer();
    fireEvent.click(
      screen.getByRole("button", { name: "Restore the page width" })
    );

    expect(wideViewerMarker(container)).toBeNull();
    expect(window.sessionStorage.getItem("publira.wide-viewer")).toBe("false");
  });

  it("follows a choice this tab already made over the value the server read", async () => {
    window.sessionStorage.setItem("publira.wide-viewer", "true");

    const { container } = await renderWithClientMessages(
      <EpisodeComicViewer
        pages={pages}
        readingDirection="rtl"
        spreadStartIndex={1}
        wideViewerEnabled={false}
      />
    );

    expect(wideViewerMarker(container)).not.toBeNull();
  });
});
