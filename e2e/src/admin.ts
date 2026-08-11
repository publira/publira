import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";

import {
  SEED_ADMIN,
  SEED_CATALOG,
  toTokyoDateTimeLocal,
} from "./scenarios/admin-publish";
import { WEB_ADMIN_BASE_URL } from "./urls";

const adminUrl = (pathname: string): string =>
  `${WEB_ADMIN_BASE_URL}${pathname}`;

/**
 * Sign in as the dev seed tenant admin. Login itself is covered by #67; this
 * only builds the authenticated state the publish-flow scenarios need.
 */
export const signInAsSeedAdmin = async (
  page: Page,
  nextPath = "/series"
): Promise<void> => {
  const next = encodeURIComponent(nextPath);
  await page.goto(adminUrl(`/login?next=${next}`));
  await page.getByLabel(/メールアドレス/u).fill(SEED_ADMIN.email);
  await page.getByLabel(/パスワード/u).fill(SEED_ADMIN.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"));
};

/** Select a Combobox or MultiCombobox option by label. */
export const selectComboboxOption = async (
  page: Page,
  inputId: string,
  optionLabel: string
): Promise<void> => {
  const input = page.locator(`#${inputId}`);
  await input.click();
  await input.fill(optionLabel);
  await page.getByRole("option", { name: optionLabel }).click();
};

export interface CreateSeriesInput {
  title: string;
  synopsis: string;
  /** When set, series is published at this absolute instant (Tokyo wall clock). */
  publishedAt?: Temporal.Instant;
  readingPeriodHours?: number;
}

/**
 * Fill and submit the series create form. Resolves after redirect to the
 * edit URL (`/series/<publicId>?created=1`).
 */
export const createSeriesViaUi = async (
  page: Page,
  input: CreateSeriesInput
): Promise<string> => {
  await page.goto(adminUrl("/series/new"));
  await expect(
    page.getByRole("heading", { name: "シリーズを新規作成" })
  ).toBeVisible();

  await page.locator("#series_title").fill(input.title);
  await page.locator("#series_synopsis").fill(input.synopsis);
  if (input.readingPeriodHours !== undefined) {
    await page
      .locator("#series_reading_period_hours")
      .fill(String(input.readingPeriodHours));
  }

  await selectComboboxOption(
    page,
    "series_label_combobox",
    SEED_CATALOG.labelName
  );
  await selectComboboxOption(
    page,
    "series_creator_combobox",
    SEED_CATALOG.creatorName
  );

  if (input.publishedAt) {
    await page
      .locator("#series_published_at")
      .fill(toTokyoDateTimeLocal(input.publishedAt));
  }

  await page.getByRole("button", { name: "シリーズを作成" }).click();
  // Must not match the create path `/series/new` — that already looks like a
  // series detail URL to a naive `/series/[^/]+` pattern.
  await page.waitForURL((url) => {
    const match = url.pathname.match(/^\/series\/(?<publicId>[^/]+)(?:\/|$)/u);
    const publicId = match?.groups?.publicId;
    return Boolean(publicId && publicId !== "new");
  });

  const match = page.url().match(/\/series\/(?<publicId>[^/?#]+)/u);
  const publicId = match?.groups?.publicId?.trim() ?? "";
  if (!publicId || publicId === "new") {
    throw new Error(`could not parse series public id from ${page.url()}`);
  }
  return publicId;
};

export interface CreateEpisodeInput {
  seriesPublicId: string;
  title: string;
  price?: number;
  readingPeriodHours?: number;
  /** When set, episode is scheduled for this absolute instant (Tokyo wall clock). */
  publishAt?: Temporal.Instant;
}

/**
 * Fill and submit the episode create form. Resolves after redirect to the
 * edit URL.
 */
export const createEpisodeViaUi = async (
  page: Page,
  input: CreateEpisodeInput
): Promise<string> => {
  await page.goto(adminUrl(`/series/${input.seriesPublicId}/episodes/new`));
  await expect(
    page.getByRole("heading", { name: /エピソード/u }).first()
  ).toBeVisible();

  await page.locator("#episode_title").fill(input.title);
  await page.locator("#episode_price").fill(String(input.price ?? 0));
  await page
    .locator("#episode_reading_period_hours")
    .fill(String(input.readingPeriodHours ?? 0));

  if (input.publishAt) {
    await page
      .locator("#episode_publish_at")
      .fill(toTokyoDateTimeLocal(input.publishAt));
  }

  await page.getByRole("button", { name: "エピソードを入稿" }).click();
  await page.waitForURL((url) => {
    const match = url.pathname.match(/\/episodes\/(?<publicId>[^/]+)(?:\/|$)/u);
    const publicId = match?.groups?.publicId;
    return Boolean(publicId && publicId !== "new");
  });

  const match = page.url().match(/\/episodes\/(?<publicId>[^/?#]+)/u);
  const publicId = match?.groups?.publicId?.trim() ?? "";
  if (!publicId || publicId === "new") {
    throw new Error(`could not parse episode public id from ${page.url()}`);
  }
  return publicId;
};

export const formMessage = (page: Page): Locator =>
  // FormMessage renders an <output> (implicit role=status).
  page.getByRole("status");
