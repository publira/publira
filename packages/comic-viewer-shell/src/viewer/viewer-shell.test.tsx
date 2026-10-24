// @vitest-environment jsdom

import { useViewerContext } from "@publira/comic-viewer";
import type {
  PageStatusValue,
  ViewerPage as Page,
} from "@publira/comic-viewer";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as Viewer from ".";
import { describeVisiblePages } from "../page-status";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const pages: Page[] = [
  { id: "page-1", src: "https://example.test/1.avif", title: "Page 1" },
  { id: "page-2", src: "https://example.test/2.avif", title: "Page 2" },
  { id: "page-3", src: "https://example.test/3.avif", title: "Page 3" },
  { id: "page-4", src: "https://example.test/4.avif", title: "Page 4" },
];

/** Stands in for the caller's catalog. */
const formatPageStatus = (value: PageStatusValue): string => {
  const visible = describeVisiblePages(value);
  switch (visible.kind) {
    case "none": {
      return "No pages";
    }
    case "end-page": {
      return "The end";
    }
    case "page": {
      return `Page ${visible.first} of ${visible.total}`;
    }
    case "spread": {
      return `Pages ${visible.first}–${visible.last} of ${visible.total}`;
    }
    default: {
      return visible satisfies never;
    }
  }
};

/** The shell as an app composes it, with `children` mounted in the root. */
const Shell = ({
  actions,
  children,
  pages: shellPages = pages,
  readingDirection = "rtl",
  spreadStartIndex = 1,
}: {
  actions?: ReactNode;
  children?: ReactNode;
  pages?: Page[];
  readingDirection?: "ltr" | "rtl";
  spreadStartIndex?: number;
}) => (
  <Viewer.Root
    pages={shellPages}
    readingDirection={readingDirection}
    spreadStartIndex={spreadStartIndex}
  >
    <Viewer.Rail boxHeight={0}>
      <Viewer.Page>
        <Viewer.PageLoading>Loading…</Viewer.PageLoading>
        <Viewer.PageError>
          <Viewer.PageErrorMessage>
            This page could not be loaded.
          </Viewer.PageErrorMessage>
          <Viewer.PageRetryButton>Reload</Viewer.PageRetryButton>
        </Viewer.PageError>
      </Viewer.Page>
    </Viewer.Rail>
    <Viewer.Empty>This episode has no pages.</Viewer.Empty>
    <Viewer.Toolbar>
      <Viewer.Progress aria-label="Reading progress">
        <Viewer.ProgressSlider format={formatPageStatus} />
        <Viewer.PageStatus format={formatPageStatus} />
      </Viewer.Progress>
      {actions === undefined ? null : (
        <Viewer.ToolbarActions>{actions}</Viewer.ToolbarActions>
      )}
    </Viewer.Toolbar>
    <Viewer.PageNavigation aria-label="Page navigation">
      <Viewer.PreviousPageButton aria-label="Previous page" />
      <Viewer.NextPageButton aria-label="Next page" />
    </Viewer.PageNavigation>
    {children}
  </Viewer.Root>
);

const LayoutProbe = () => {
  const { currentIndex, readingDirection, spreadStartIndex } =
    useViewerContext();

  return <p>{`${readingDirection}:${spreadStartIndex}:${currentIndex}`}</p>;
};

/** A page request that is still in flight when the test looks. */
const pendingFetch = () =>
  vi.fn<typeof fetch>(() => Promise.withResolvers<Response>().promise);

/** The class of the icon inside the page-turn button named `name`. */
const iconOf = (name: string) =>
  screen
    .getByRole("button", { hidden: true, name })
    .querySelector("svg")
    ?.getAttribute("class");

/** Press the viewer the way a keyboard does, which shows or hides its controls. */
const pressViewer = () => {
  fireEvent.keyDown(screen.getByRole("button", { name: /^Page \d/u }), {
    key: "Enter",
  });
};

describe("Viewer.Root", () => {
  it("opens in the reading direction and spread start it is given", () => {
    render(
      <Shell readingDirection="ltr" spreadStartIndex={0}>
        <LayoutProbe />
      </Shell>
    );

    expect(screen.getByText("ltr:0:0")).toBeDefined();
    expect(
      screen.getByRole("button", { name: /Page 1/u }).dataset.readingDirection
    ).toBe("ltr");
  });

  it("asks for a page with the Accept header image-server resizes by", async () => {
    const fetchMock = pendingFetch();
    vi.stubGlobal("fetch", fetchMock);

    render(<Shell />);

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    for (const [url, init] of fetchMock.mock.calls) {
      expect(pages.map((page) => page.src)).toContain(String(url));
      expect(new Headers(init?.headers).get("Accept")).toContain("image/avif");
    }
  });
});

describe("Viewer.Rail", () => {
  it("animates the track only while a turn is under way, and zooms the current slot alone", () => {
    const { container } = render(<Shell />);

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

describe("Viewer.Page", () => {
  it("says a page is loading while it has nothing on screen", () => {
    vi.stubGlobal("fetch", pendingFetch());

    render(<Shell />);

    expect(screen.getAllByText("Loading…").length).toBeGreaterThan(0);
  });

  it("offers another attempt at a page that failed, without turning it", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(null, { status: 503 }))
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <Shell>
        <LayoutProbe />
      </Shell>
    );

    const [reload] = await screen.findAllByRole("button", { name: "Reload" });
    expect(screen.getAllByRole("alert")[0]?.textContent).toContain(
      "This page could not be loaded."
    );
    const attempts = fetchMock.mock.calls.length;

    fireEvent.click(reload as HTMLElement);

    expect(screen.getByText("rtl:1:0")).toBeDefined();
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(attempts);
    });
  });
});

describe("Viewer.Empty", () => {
  it("says the episode has no pages instead of leaving the mat bare", () => {
    render(<Shell pages={[]} />);

    expect(screen.getByText("This episode has no pages.")).toBeDefined();
  });

  it("stays out of the way of an episode that has pages", () => {
    render(<Shell />);

    expect(screen.queryByText("This episode has no pages.")).toBeNull();
  });
});

describe("Viewer.Toolbar", () => {
  it("announces the pages under the thumb in the words the page status shows", () => {
    render(<Shell />);
    pressViewer();

    const slider = screen.getByRole("slider", { name: "Reading progress" });
    expect(slider.getAttribute("aria-valuetext")).toBe("Page 1 of 4");
    expect(screen.getByText("Page 1 of 4")).toBeDefined();

    fireEvent.change(slider, { target: { value: "1" } });

    expect(slider.getAttribute("aria-valuetext")).toBe("Pages 2–3 of 4");
    expect(screen.getByText("Pages 2–3 of 4")).toBeDefined();
  });

  it("keeps room for the app's own controls only where it has some", () => {
    const { container, rerender } = render(<Shell />);
    const toolbar = () =>
      container.querySelector("[data-viewer-toolbar-actions]");

    expect(toolbar()).toBeNull();

    rerender(<Shell actions={<button type="button">Full screen</button>} />);

    expect(toolbar()?.textContent).toBe("Full screen");
  });
});

describe("Viewer.PageNavigation", () => {
  it.each([
    {
      backward: "chevron-right",
      forward: "chevron-left",
      readingDirection: "rtl",
    },
    {
      backward: "chevron-left",
      forward: "chevron-right",
      readingDirection: "ltr",
    },
  ] as const)(
    "points each chevron the way a $readingDirection episode turns",
    ({ backward, forward, readingDirection }) => {
      render(<Shell readingDirection={readingDirection} />);

      expect(iconOf("Next page")).toContain(forward);
      expect(iconOf("Previous page")).toContain(backward);
    }
  );

  it("turns the page in the reading direction", () => {
    render(
      <Shell spreadStartIndex={0}>
        <LayoutProbe />
      </Shell>
    );
    pressViewer();

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));

    expect(screen.getByText("rtl:0:2")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));

    expect(screen.getByText("rtl:0:0")).toBeDefined();
  });
});
