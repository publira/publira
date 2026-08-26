import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";

import {
  SEED_ADMIN,
  SEED_CATALOG,
  toTokyoDateTimeLocal,
} from "./scenarios/admin-publish";
import { fillLoginForm } from "./session";
import { WEB_ADMIN_BASE_URL } from "./urls";

const adminUrl = (pathname: string): string =>
  `${WEB_ADMIN_BASE_URL}${pathname}`;

export const signInAsAdmin = async (
  page: Page,
  credentials: { email: string; password: string } = SEED_ADMIN,
  nextPath = "/series"
): Promise<void> => {
  const next = encodeURIComponent(nextPath);
  await page.goto(adminUrl(`/login?next=${next}`));
  await fillLoginForm(page, credentials);
  await page.waitForURL((url) => !url.pathname.endsWith("/login"));
};

/** Sign in as the dev seed tenant admin (`admin@example.com`). */
export const signInAsSeedAdmin = async (
  page: Page,
  nextPath = "/series"
): Promise<void> => {
  await signInAsAdmin(page, SEED_ADMIN, nextPath);
};

/** Open the console header's user menu (avatar). */
export const openAdminUserMenu = async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: "アカウントメニュー" }).click();
};

export const signOutAdmin = async (page: Page): Promise<void> => {
  await openAdminUserMenu(page);
  await page.getByRole("menuitem", { name: "ログアウト" }).click();
  await page.waitForURL((url) => url.pathname.endsWith("/login"));
};

/** Select a Combobox or MultiCombobox option by label. */
export const selectComboboxOption = async (
  page: Page,
  combobox: Locator,
  optionLabel: string
): Promise<void> => {
  await combobox.click();
  await combobox.fill(optionLabel);
  await page.getByRole("option", { name: optionLabel }).click();
};

export interface SeriesFormFields {
  title: Locator;
  readingPeriodHours: Locator;
  synopsis: Locator;
  creatorCombobox: Locator;
  labelCombobox: Locator;
  publishedAt: Locator;
}

/**
 * Fields of the series form on the page the router currently shows.
 *
 * Next.js keeps recently visited pages mounted inside a hidden `<Activity>`
 * for its router bfcache, so the create form stays in the DOM while the edit
 * page is on screen. Role locators skip elements that are hidden from the
 * accessibility tree, which pins these to the page in front of the user.
 */
export const seriesFormFields = (page: Page): SeriesFormFields => ({
  creatorCombobox: page.getByRole("combobox", { name: /クリエイター/u }),
  labelCombobox: page.getByRole("combobox", { name: /レーベル/u }),
  // `datetime-local` has no ARIA role, so this one filters on visibility.
  publishedAt: page.getByLabel(/公開日時/u).filter({ visible: true }),
  readingPeriodHours: page.getByRole("spinbutton", { name: /閲覧可能期間/u }),
  synopsis: page.getByRole("textbox", { name: /概要/u }),
  title: page.getByRole("textbox", { name: /タイトル/u }),
});

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

  const fields = seriesFormFields(page);
  await fields.title.fill(input.title);
  await fields.synopsis.fill(input.synopsis);
  if (input.readingPeriodHours !== undefined) {
    await fields.readingPeriodHours.fill(String(input.readingPeriodHours));
  }

  await selectComboboxOption(
    page,
    fields.labelCombobox,
    SEED_CATALOG.labelName
  );
  await selectComboboxOption(
    page,
    fields.creatorCombobox,
    SEED_CATALOG.creatorName
  );

  if (input.publishedAt) {
    await fields.publishedAt.fill(toTokyoDateTimeLocal(input.publishedAt));
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

export interface EpisodeFormFields {
  title: Locator;
  price: Locator;
  readingPeriodHours: Locator;
  publishAt: Locator;
}

/**
 * Fields of the episode form on the page the router currently shows.
 *
 * Next.js keeps recently visited pages mounted inside a hidden `<Activity>`
 * for its router bfcache, so the create form stays in the DOM while the edit
 * page is on screen. Role locators skip elements that are hidden from the
 * accessibility tree, which pins these to the page in front of the user.
 */
export const episodeFormFields = (page: Page): EpisodeFormFields => ({
  price: page.getByRole("spinbutton", { name: /価格/u }),
  publishAt: page.getByLabel(/publish_at/u).filter({ visible: true }),
  readingPeriodHours: page.getByRole("spinbutton", { name: /閲覧可能期間/u }),
  title: page.getByRole("textbox", { name: /タイトル/u }),
});

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

  const fields = episodeFormFields(page);
  await fields.title.fill(input.title);
  await fields.price.fill(String(input.price ?? 0));
  await fields.readingPeriodHours.fill(String(input.readingPeriodHours ?? 0));

  if (input.publishAt) {
    await fields.publishAt.fill(toTokyoDateTimeLocal(input.publishAt));
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
  // FormMessage renders a <p role="status">.
  page.getByRole("status");
