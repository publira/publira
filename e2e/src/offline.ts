import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

/** The copy every app's catalog gives the connectivity notice in `en`. */
export const OFFLINE_NOTICE_TEXT =
  "You're offline. Waiting for the connection to come back.";

/** The notice, located by the text it shows only while offline. */
export const offlineNotice = (page: Page): Locator =>
  page.getByText(OFFLINE_NOTICE_TEXT, { exact: true });

type Box = NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>;

const boxOf = async (locator: Locator): Promise<Box> => {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error(`${locator.toString()} has no bounding box`);
  }
  return box;
};

const intersects = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

/** Fails when the visible notice overlaps any of `controls` on screen. */
export const expectNoticeClearOf = async (
  page: Page,
  controls: Locator
): Promise<void> => {
  const [notice, controlList] = await Promise.all([
    boxOf(offlineNotice(page)),
    controls.all(),
  ]);
  const boxes = await Promise.all(
    controlList.map(async (control) => ({
      box: await boxOf(control),
      name: control.toString(),
    }))
  );

  for (const { box, name } of boxes) {
    expect(intersects(notice, box), `the offline notice covers ${name}`).toBe(
      false
    );
  }
};

/**
 * Takes the page offline, checks the notice appears as a polite live region
 * without taking focus, runs `whileOffline`, and checks that reconnecting
 * clears the notice with no reload.
 */
export const goOfflineAndBack = async (
  page: Page,
  whileOffline?: () => Promise<void>
): Promise<void> => {
  const notice = offlineNotice(page);
  await expect(notice).toHaveCount(0);
  const focused = await page.evaluateHandle(() => document.activeElement);
  const navigations: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      navigations.push(frame.url());
    }
  });

  await page.context().setOffline(true);

  await expect(notice).toBeVisible();
  await expect(
    notice.locator("xpath=ancestor::*[@aria-live][1]")
  ).toHaveAttribute("aria-live", "polite");
  expect(
    await page.evaluate(
      (element) => document.activeElement === element,
      focused
    ),
    "going offline moves focus"
  ).toBe(true);
  await whileOffline?.();

  await page.context().setOffline(false);

  await expect(notice).toHaveCount(0);
  expect(navigations, "reconnecting reloads the page").toEqual([]);
};
