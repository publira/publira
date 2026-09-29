import "temporal-polyfill/global";
import type { Page } from "@playwright/test";

/**
 * Stop the browser's wall clock at one instant, so a screen that words a
 * timestamp as how long ago it was photographs the same way every day.
 *
 * A page can read the clock through two different objects, and freezing one
 * does not freeze the other:
 *
 * - `Date`, which `page.clock` replaces. `temporal-polyfill` derives
 *   `Temporal.Now` from `Date.now()`, so a browser that runs the polyfill is
 *   covered by this alone.
 * - `Temporal.Now`, which the engine answers from the host clock directly.
 *   Playwright's clock does not touch it, and the Chromium pinned in
 *   `e2e/browser` already ships `Temporal` — so `temporal-polyfill/global`
 *   steps aside there (`install()` is `NativeTemporal || installImplementation()`)
 *   and this is the source that actually decides the phrase today.
 *
 * Both are set, because which one answers depends on the browser rather than
 * on anything this repository controls.
 *
 * Call it before `page.goto`: the init script has to run ahead of the page's
 * own scripts.
 */
export const freezeClock = async (
  page: Page,
  instant: string
): Promise<void> => {
  await page.clock.setFixedTime(instant);

  await page.addInitScript((iso: string) => {
    const temporal = (globalThis as { Temporal?: typeof Temporal }).Temporal;
    // Absent until the polyfill installs its own, further down the page's
    // startup. That one reads `Date.now()`, which is already frozen above.
    if (!temporal) {
      return;
    }

    const fixed = temporal.Instant.from(iso);
    const systemTimeZoneId = temporal.Now.timeZoneId();
    const zoned = (timeZone?: string) =>
      fixed.toZonedDateTimeISO(timeZone ?? systemTimeZoneId);

    // The whole namespace, not `instant()` alone: a half-frozen `Temporal.Now`
    // would answer one caller with the fixed moment and the next with the real
    // one, which is harder to explain than either.
    Object.defineProperty(temporal, "Now", {
      configurable: true,
      value: {
        instant: () => fixed,
        plainDateISO: (timeZone?: string) => zoned(timeZone).toPlainDate(),
        plainDateTimeISO: (timeZone?: string) =>
          zoned(timeZone).toPlainDateTime(),
        plainTimeISO: (timeZone?: string) => zoned(timeZone).toPlainTime(),
        timeZoneId: () => systemTimeZoneId,
        zonedDateTimeISO: (timeZone?: string) => zoned(timeZone),
      },
      writable: true,
    });
  }, instant);
};
