import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import {
  VIEWER_EPISODE_PATH,
  VIEWER_PAGE_COUNT,
  VIEWER_PROGRESS_LABEL,
  viewerPageLabel,
} from "../src/scenarios/viewer-pages";
import { hostPath } from "../src/urls";

/**
 * Rendering budget for the canvas reader.
 *
 * These are ceilings, not targets. A warm dev-container stack draws the first
 * page in a little over 200ms and turns within a single frame, so every budget
 * sits several times above what the reader costs today: a slower shared CI
 * runner still passes, while anything that starts waiting on the network or
 * blocking the main thread crosses them. `e2e/README.md` records how to take the
 * numbers again.
 *
 * Raising one is a decision about the product, not a way to quiet a red build:
 * measure first, then say in the pull request what got slower and why that is
 * acceptable.
 */
const BUDGET = {
  /** Navigation start → the first page is on the canvas. */
  firstPageDrawnMs: 2000,
  /** A page turn must not move the layout at all; this is slack for rounding. */
  layoutShift: 0.01,
  /**
   * Key press → the next spread's first page is on the canvas. The viewer has
   * already fetched and decoded it, so this normally lands on the same frame as
   * the response; when it does not, the turn is waiting on the network and the
   * prefetch pipeline has regressed.
   */
  turnPageReadyMs: 600,
  /** Key press → the reader reports the new spread. */
  turnResponseMs: 200,
} as const;

interface ViewerTurnMetrics {
  pageReadyMs: number | null;
  responseMs: number | null;
}

interface ViewerMetrics {
  cumulativeLayoutShift: number;
  firstPageDrawnMs: number | null;
  armTurn: (targetPageLabel: string) => void;
  /**
   * Whether this browser reports `layout-shift` at all. Without it the shift
   * total would stay a convincing `0` forever, so the suite checks it rather
   * than trusting a silent pass.
   */
  layoutShiftSupported: boolean;
  turn: ViewerTurnMetrics;
}

declare global {
  interface Window {
    __publiraViewerMetrics?: ViewerMetrics;
  }
}

/**
 * Installed before any application script so the observers are already running
 * when the reader mounts.
 *
 * Every timestamp is `performance.now()`, which a document counts from its own
 * navigation start, and every one of them is taken inside `requestAnimationFrame`
 * — the viewer draws its bitmap in a layout effect, so the frame that runs
 * after it is the frame that puts the page on screen.
 */
const installViewerMetrics = (progressLabel: string) => {
  const DRAWN_SELECTOR = 'canvas[data-page-status="loaded"]:not([aria-busy])';
  const TURN_TIMEOUT_MS = 10_000;

  const metrics: ViewerMetrics = {
    armTurn: () => {
      // Replaced below, once the helpers it needs are in scope.
    },
    cumulativeLayoutShift: 0,
    firstPageDrawnMs: null,
    layoutShiftSupported:
      PerformanceObserver.supportedEntryTypes.includes("layout-shift"),
    turn: { pageReadyMs: null, responseMs: null },
  };
  window.__publiraViewerMetrics = metrics;

  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const shift = entry as PerformanceEntry & {
        hadRecentInput: boolean;
        value: number;
      };
      if (!shift.hadRecentInput) {
        metrics.cumulativeLayoutShift += shift.value;
      }
    }
  }).observe({ buffered: true, type: "layout-shift" });

  const readProgress = (): string =>
    document
      .querySelector(`[aria-label="${progressLabel}"]`)
      ?.getAttribute("value") ?? "";

  const isDrawn = (label: string): boolean =>
    [...document.querySelectorAll(DRAWN_SELECTOR)].some(
      (canvas) => canvas.getAttribute("aria-label") === label
    );

  const firstPaintObserver = new MutationObserver(() => {
    if (
      metrics.firstPageDrawnMs !== null ||
      document.querySelector(DRAWN_SELECTOR) === null
    ) {
      return;
    }
    requestAnimationFrame(() => {
      metrics.firstPageDrawnMs ??= performance.now();
    });
    firstPaintObserver.disconnect();
  });
  // `document`, not `documentElement`: an init script runs before the parser
  // has produced an `<html>` element to observe.
  firstPaintObserver.observe(document, {
    attributes: true,
    childList: true,
    subtree: true,
  });

  metrics.armTurn = (targetPageLabel: string) => {
    metrics.turn = { pageReadyMs: null, responseMs: null };
    const before = readProgress();

    // Timed from the keydown itself rather than from this call, so the round
    // trip that asks the browser to press the key stays out of the number.
    window.addEventListener(
      "keydown",
      () => {
        const start = performance.now();
        const tick = () => {
          const elapsed = performance.now() - start;
          if (metrics.turn.responseMs === null && readProgress() !== before) {
            metrics.turn.responseMs = elapsed;
          }
          if (metrics.turn.pageReadyMs === null && isDrawn(targetPageLabel)) {
            metrics.turn.pageReadyMs = elapsed;
          }
          if (
            (metrics.turn.responseMs !== null &&
              metrics.turn.pageReadyMs !== null) ||
            elapsed > TURN_TIMEOUT_MS
          ) {
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      { once: true }
    );
  };
};

/**
 * One pass over the reader: open the episode, wait for the first page, turn
 * once, and hand back what the in-page observers recorded.
 *
 * The reading direction is right to left, so ArrowLeft is the next page. With
 * `spreadStartIndex` at 1 the cover stands alone, which puts pages 2 and 3 on
 * screen after one turn.
 */
const readOneSpread = async (page: Page) => {
  await page.addInitScript(installViewerMetrics, VIEWER_PROGRESS_LABEL);
  await page.goto(hostPath(VIEWER_EPISODE_PATH));

  await expect(
    page.locator(`canvas[aria-label="${viewerPageLabel(1)}"]`)
  ).toHaveAttribute("data-page-status", "loaded");
  await page.waitForFunction(
    () =>
      window.__publiraViewerMetrics?.firstPageDrawnMs !== undefined &&
      window.__publiraViewerMetrics.firstPageDrawnMs !== null
  );

  await page.evaluate(
    (label) => window.__publiraViewerMetrics?.armTurn(label),
    viewerPageLabel(2)
  );
  await page.keyboard.press("ArrowLeft");
  await page.waitForFunction(() => {
    const turn = window.__publiraViewerMetrics?.turn;
    return (
      turn?.pageReadyMs !== undefined &&
      turn.pageReadyMs !== null &&
      turn.responseMs !== null
    );
  });

  return await page.evaluate(() => {
    const metrics = window.__publiraViewerMetrics;
    return {
      cumulativeLayoutShift: metrics?.cumulativeLayoutShift ?? 0,
      firstPageDrawnMs: metrics?.firstPageDrawnMs ?? null,
      layoutShiftSupported: metrics?.layoutShiftSupported ?? false,
      turnPageReadyMs: metrics?.turn.pageReadyMs ?? null,
      turnResponseMs: metrics?.turn.responseMs ?? null,
    };
  });
};

test.describe("web-host viewer rendering performance", () => {
  /**
   * image-server converts a page with Manael on the first request for a given
   * size and format, and serves the cached rendition afterwards. Measuring the
   * cold conversion would report libvips throughput rather than the reader, and
   * that is explicitly not what this budget is about, so one discarded pass
   * warms both that cache and web-host's rendered shell.
   */
  test.beforeAll(async ({ browser }) => {
    const warmUpPage = await browser.newPage();
    try {
      await readOneSpread(warmUpPage);
    } finally {
      await warmUpPage.close();
    }
  });

  test("draws the first page, turns, and never moves the layout", async ({
    page,
  }) => {
    const measured = await readOneSpread(page);

    for (const [name, value] of Object.entries(measured)) {
      test.info().annotations.push({
        description: String(value),
        type: `viewer-performance:${name}`,
      });
    }

    await expect(page.getByLabel(VIEWER_PROGRESS_LABEL)).toHaveAttribute(
      "max",
      String(VIEWER_PAGE_COUNT)
    );
    expect(measured.layoutShiftSupported, "layout-shift is observable").toBe(
      true
    );

    expect
      .soft(measured.firstPageDrawnMs, "first page drawn (ms)")
      .toBeLessThan(BUDGET.firstPageDrawnMs);
    expect
      .soft(measured.turnResponseMs, "page turn response (ms)")
      .toBeLessThan(BUDGET.turnResponseMs);
    expect
      .soft(measured.turnPageReadyMs, "page turn drawn (ms)")
      .toBeLessThan(BUDGET.turnPageReadyMs);
    expect
      .soft(measured.cumulativeLayoutShift, "cumulative layout shift")
      .toBeLessThanOrEqual(BUDGET.layoutShift);
  });
});
