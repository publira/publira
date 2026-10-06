// @vitest-environment jsdom

import { useViewerContext } from "@publira/comic-viewer";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { act } from "react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EpisodeDetail } from "#lib/catalog";
import { renderWithClientMessages } from "#lib/render-with-client-messages";

import { READING_POSITION_SAVE_DELAY_MS } from "../_lib/reading-position";
import { EpisodeComicViewer } from "./episode-comic-viewer";
import { EpisodeNeighborKeyNavigation } from "./episode-neighbor-key-navigation";
import { EpisodeReadRecorder } from "./episode-read-recorder";
import { EpisodeReadingPositionRecorder } from "./episode-reading-position-recorder";

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("#components/locale-context", () => ({
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
  mockPush.mockReset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
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
  fireEvent.keyDown(screen.getByRole("button", { name: /^Page \d/u }), {
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

const episode: EpisodeDetail = {
  credits: [],
  id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  orderIndex: 1,
  price: 0,
  publicId: "EPISODE_001",
  publishedAt: "2026-08-01T00:00:00Z",
  purchaseSurface: "all",
  ratingCount: 0,
  readingDirection: "rtl",
  readingPeriodHours: 0,
  scheduledAt: "",
  spreadStartIndex: 1,
  status: "published",
  title: "First light",
};

const CurrentIndexProbe = () => {
  const { currentIndex } = useViewerContext();

  return <p>{`current:${currentIndex}`}</p>;
};

const progressSlider = () =>
  screen.getByRole("slider", { name: "Reading progress" });

/** The page status under the slider, which names the spread it points at. */
const pageStatus = () => screen.getByText(/^Pages? /u);

/** The reader rests where they are for longer than the save delay. */
const settle = () =>
  act(() => vi.advanceTimersByTimeAsync(READING_POSITION_SAVE_DELAY_MS));

/** Grab the thumb and move it to `positions` in turn, without letting go. */
const dragThumb = (...positions: number[]) => {
  const slider = progressSlider();
  fireEvent.pointerDown(slider);
  for (const position of positions) {
    fireEvent.change(slider, { target: { value: String(position) } });
  }
};

const releaseThumb = () => {
  fireEvent.pointerUp(window);
};

describe("EpisodeComicViewer progress slider", () => {
  it("counts every page of the episode and the end page after it", async () => {
    await renderWithClientMessages(
      <EpisodeComicViewer
        endPage={<p>Leave a comment</p>}
        pages={pages}
        readingDirection="rtl"
        spreadStartIndex={1}
        wideViewerEnabled={false}
      />
    );
    pressViewer();

    const slider = progressSlider();
    expect(slider.getAttribute("min")).toBe("0");
    expect(slider.getAttribute("max")).toBe(String(pages.length));
    expect(pageStatus().textContent).toBe("Page 1 of 4");
  });

  it("shows the page under the thumb while dragging and turns to it on release", async () => {
    await renderWithClientMessages(
      <EpisodeComicViewer
        pages={pages}
        readingDirection="rtl"
        spreadStartIndex={1}
        wideViewerEnabled={false}
      >
        <CurrentIndexProbe />
      </EpisodeComicViewer>
    );
    pressViewer();

    dragThumb(1.4, 2.6);

    expect(pageStatus().textContent).toBe("Page 4 of 4");
    expect(
      screen.getByText("current:0"),
      "the reader has not left the page they were on mid-drag"
    ).toBeDefined();

    releaseThumb();

    expect(screen.getByText("current:3")).toBeDefined();
    expect(pageStatus().textContent).toBe("Page 4 of 4");
  });

  it("saves the page the reader lets go on, once, and nothing the thumb passed over", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(null, { status: 204 }))
    );
    vi.stubGlobal("fetch", fetchMock);
    // The viewer fetches the page images through the same global.
    const savedPageIndices = () =>
      fetchMock.mock.calls
        .filter(([url]) => String(url).endsWith("/reading-position"))
        .map(([, init]) => {
          const payload: unknown = JSON.parse(String(init?.body));
          return (payload as { pageIndex: number }).pageIndex;
        });

    await renderWithClientMessages(
      <EpisodeComicViewer
        pages={pages}
        readingDirection="rtl"
        spreadStartIndex={1}
        wideViewerEnabled={false}
      >
        <EpisodeReadingPositionRecorder episode={episode} />
      </EpisodeComicViewer>
    );
    await settle();
    expect(
      savedPageIndices(),
      "opening the episode saves its first page"
    ).toEqual([0]);

    pressViewer();
    dragThumb(1);
    // Holding the thumb over a page for longer than the save delay is not
    // settling on it.
    await settle();
    dragThumb(2.6);
    await settle();
    releaseThumb();
    await settle();

    expect(savedPageIndices()).toEqual([0, 3]);
  });

  it("finishes the episode when the reader lets go on its last page, and not before", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(null, { status: 204 }))
    );
    vi.stubGlobal("fetch", fetchMock);
    const readReports = () =>
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/read"));

    await renderWithClientMessages(
      <EpisodeComicViewer
        pages={pages}
        readingDirection="rtl"
        spreadStartIndex={1}
        wideViewerEnabled={false}
      >
        <EpisodeReadRecorder episode={episode} />
      </EpisodeComicViewer>
    );
    pressViewer();

    dragThumb(3);
    expect(
      readReports(),
      "the last page under the thumb is not yet read"
    ).toHaveLength(0);

    releaseThumb();
    expect(readReports()).toHaveLength(1);
  });

  it("turns one spread for a keyboard step on the focused slider", async () => {
    await renderWithClientMessages(
      <EpisodeComicViewer
        pages={pages}
        readingDirection="rtl"
        spreadStartIndex={1}
        wideViewerEnabled={false}
      >
        <CurrentIndexProbe />
      </EpisodeComicViewer>
    );
    pressViewer();

    // jsdom has no native range behaviour, so the step an arrow key makes is
    // delivered as the change event the browser would fire for it: one index
    // on from where the thumb rests.
    fireEvent.change(progressSlider(), { target: { value: "1" } });

    expect(screen.getByText("current:1")).toBeDefined();
    expect(pageStatus().textContent).toBe("Pages 2–3 of 4");

    fireEvent.change(progressSlider(), { target: { value: "2" } });

    expect(
      screen.getByText("current:3"),
      "a step onto the facing page of a spread goes on to the next spread"
    ).toBeDefined();
    expect(pageStatus().textContent).toBe("Page 4 of 4");
  });

  it("leaves an arrow key on the focused slider to the slider at the end of the episode", async () => {
    await renderWithClientMessages(
      <EpisodeComicViewer
        initialPageIndex={pages.length - 1}
        pages={pages}
        readingDirection="rtl"
        spreadStartIndex={1}
        wideViewerEnabled={false}
      >
        <EpisodeNeighborKeyNavigation nextHref="/series/SERIES_001/episodes/EPISODE_002" />
      </EpisodeComicViewer>
    );
    pressViewer();

    const slider = progressSlider();
    slider.focus();
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    fireEvent.keyDown(slider, { key: "ArrowLeft" });

    expect(
      screen.queryByText("Press the key again to open the next episode.")
    ).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe("EpisodeComicViewer neighbouring episodes", () => {
  it("hands the control that has run out of pages over to the episode before", async () => {
    await renderWithClientMessages(
      <EpisodeComicViewer
        nextEpisodeHref="/series/SR01/episodes/EP03"
        pages={pages}
        previousEpisodeHref="/series/SR01/episodes/EP01"
        readingDirection="rtl"
        spreadStartIndex={0}
        wideViewerEnabled={false}
      />
    );

    // The controls start hidden, which takes them out of the accessibility
    // tree until a tap brings them out.
    const previous = screen.getByRole("link", {
      hidden: true,
      name: "Previous episode",
    });
    expect(previous.getAttribute("href")).toBe("/series/SR01/episodes/EP01");
    expect(
      screen.queryByRole("button", { hidden: true, name: "Previous page" })
    ).toBeNull();
    // The other end still has pages to turn.
    expect(
      screen.getByRole("button", { hidden: true, name: "Next page" })
    ).toBeDefined();
    expect(
      screen.queryByRole("link", { hidden: true, name: "Next episode" })
    ).toBeNull();
  });

  it("hands the control over to the episode after on the last page", async () => {
    await renderWithClientMessages(
      <EpisodeComicViewer
        initialPageIndex={pages.length - 1}
        nextEpisodeHref="/series/SR01/episodes/EP03"
        pages={pages}
        previousEpisodeHref="/series/SR01/episodes/EP01"
        readingDirection="ltr"
        spreadStartIndex={0}
        wideViewerEnabled={false}
      />
    );

    const next = screen.getByRole("link", {
      hidden: true,
      name: "Next episode",
    });
    expect(next.getAttribute("href")).toBe("/series/SR01/episodes/EP03");
    expect(
      screen.queryByRole("button", { hidden: true, name: "Next page" })
    ).toBeNull();
    expect(
      screen.getByRole("button", { hidden: true, name: "Previous page" })
    ).toBeDefined();
  });

  it("keeps the page-turn control where there is no episode to hand over to", async () => {
    await renderWithClientMessages(
      <EpisodeComicViewer
        pages={pages}
        readingDirection="rtl"
        spreadStartIndex={0}
        wideViewerEnabled={false}
      />
    );

    expect(
      screen.getByRole("button", { hidden: true, name: "Previous page" })
    ).toBeDefined();
    expect(
      screen.queryByRole("link", { hidden: true, name: "Previous episode" })
    ).toBeNull();
  });
});
