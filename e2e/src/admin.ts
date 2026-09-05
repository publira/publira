import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";

import {
  SEED_ADMIN,
  SEED_CATALOG,
  toTokyoDateTimeLocal,
} from "./scenarios/admin-publish";
import { NOTIFICATION_INBOX_ADMIN } from "./scenarios/notification-inbox";
import { fillLoginForm } from "./session";
import {
  WEB_ADMIN_BASE_URL,
  WEB_ADMIN_NOTIFICATION_INBOX_BASE_URL,
} from "./urls";

const adminUrl = (pathname: string, baseUrl = WEB_ADMIN_BASE_URL): string =>
  `${baseUrl}${pathname}`;

export const signInAsAdmin = async (
  page: Page,
  credentials: { email: string; password: string } = SEED_ADMIN,
  nextPath = "/series",
  baseUrl = WEB_ADMIN_BASE_URL
): Promise<void> => {
  const next = encodeURIComponent(nextPath);
  await page.goto(adminUrl(`/login?next=${next}`, baseUrl));
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

/** Sign in as the inbox tenant's admin, on that tenant's own console. */
export const signInAsNotificationInboxAdmin = async (
  page: Page,
  nextPath = "/series"
): Promise<void> => {
  await signInAsAdmin(
    page,
    NOTIFICATION_INBOX_ADMIN,
    nextPath,
    WEB_ADMIN_NOTIFICATION_INBOX_BASE_URL
  );
};

/** Open the console header's user menu (avatar). */
export const openAdminUserMenu = async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: "Account menu" }).click();
};

export const signOutAdmin = async (page: Page): Promise<void> => {
  await openAdminUserMenu(page);
  await page.getByRole("menuitem", { name: "Sign out" }).click();
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
  creatorCombobox: page.getByRole("combobox", { name: /Creators/u }),
  labelCombobox: page.getByRole("combobox", { name: /Label/u }),
  // `datetime-local` has no ARIA role, so this one filters on visibility.
  publishedAt: page
    .getByLabel(/Publication date and time/u)
    .filter({ visible: true }),
  readingPeriodHours: page.getByRole("spinbutton", { name: /Reading period/u }),
  synopsis: page.getByRole("textbox", { name: /Synopsis/u }),
  title: page.getByRole("textbox", { name: /Title/u }),
});

export interface CreateSeriesInput {
  title: string;
  synopsis: string;
  /** Creator to attach. Defaults to the seeded author. */
  creatorName?: string;
  /** Label to attach. Defaults to the seeded label. */
  labelName?: string;
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
    page.getByRole("heading", { name: "Create series" })
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
    input.labelName ?? SEED_CATALOG.labelName
  );
  await selectComboboxOption(
    page,
    fields.creatorCombobox,
    input.creatorName ?? SEED_CATALOG.creatorName
  );

  if (input.publishedAt) {
    await fields.publishedAt.fill(toTokyoDateTimeLocal(input.publishedAt));
  }

  await page.getByRole("button", { name: "Create series" }).click();
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
  price: page.getByRole("spinbutton", { name: /Price/u }),
  publishAt: page.getByLabel(/publish_at/u).filter({ visible: true }),
  readingPeriodHours: page.getByRole("spinbutton", { name: /Reading period/u }),
  title: page.getByRole("textbox", { name: /Title/u }),
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
    page.getByRole("heading", { name: /Create episode/u }).first()
  ).toBeVisible();

  const fields = episodeFormFields(page);
  await fields.title.fill(input.title);
  await fields.price.fill(String(input.price ?? 0));
  await fields.readingPeriodHours.fill(String(input.readingPeriodHours ?? 0));

  if (input.publishAt) {
    await fields.publishAt.fill(toTokyoDateTimeLocal(input.publishAt));
  }

  await page.getByRole("button", { name: "Submit episode" }).click();
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

export interface LabelFormFields {
  name: Locator;
}

/**
 * Fields of the label form on the page the router currently shows.
 *
 * Role locators for the same reason as {@link seriesFormFields}: the router
 * bfcache keeps a previously visited form mounted inside a hidden
 * `<Activity>`, and only the one in front of the user is in the accessibility
 * tree.
 */
export const labelFormFields = (page: Page): LabelFormFields => ({
  name: page.getByRole("textbox", { name: /Label name/u }),
});

/**
 * Fill and submit the label create form. Resolves after redirect to the
 * edit URL (`/labels/<publicId>?created=1`).
 */
export const createLabelViaUi = async (
  page: Page,
  name: string
): Promise<string> => {
  await page.goto(adminUrl("/labels/new"));
  await expect(
    page.getByRole("heading", { name: "Create label" })
  ).toBeVisible();

  await labelFormFields(page).name.fill(name);
  await page.getByRole("button", { name: "Create label" }).click();
  // Must not match the create path `/labels/new` — that already looks like a
  // label detail URL to a naive `/labels/[^/]+` pattern.
  await page.waitForURL((url) => {
    const match = url.pathname.match(/^\/labels\/(?<publicId>[^/]+)(?:\/|$)/u);
    const publicId = match?.groups?.publicId;
    return Boolean(publicId && publicId !== "new");
  });

  const match = page.url().match(/\/labels\/(?<publicId>[^/?#]+)/u);
  const publicId = match?.groups?.publicId?.trim() ?? "";
  if (!publicId || publicId === "new") {
    throw new Error(`could not parse label public id from ${page.url()}`);
  }
  return publicId;
};

/**
 * Fill a text field and confirm the value that arrived is the whole value.
 *
 * The console's fields are controlled React inputs. `fill` selects what is
 * there and replaces it, and a re-render landing between those two steps —
 * hydration finishing on a loaded runner, say — collapses the selection, so
 * the new text is inserted in front of the old one instead of replacing it.
 * The result is a form that submits both, which fails much later and reads
 * like a product defect. Asserting the value here turns that into a retry.
 */
export const fillField = async (
  field: Locator,
  value: string
): Promise<void> => {
  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value, { timeout: 2000 });
  }).toPass({ timeout: 30_000 });
};

export interface CreatorFormFields {
  name: Locator;
  profileText: Locator;
}

/**
 * Fields of the creator form on the page the router currently shows.
 *
 * Role locators for the same reason as {@link seriesFormFields}: the router
 * bfcache keeps a previously visited form mounted inside a hidden
 * `<Activity>`, and only the one in front of the user is in the accessibility
 * tree.
 */
export const creatorFormFields = (page: Page): CreatorFormFields => ({
  name: page.getByRole("textbox", { name: /Name/u }),
  profileText: page.getByRole("textbox", { name: /Profile/u }),
});

export interface CreateCreatorInput {
  name: string;
  /** Optional on the form; omitted leaves the profile empty. */
  profileText?: string;
}

/**
 * Fill and submit the creator create form. Resolves after the redirect to the
 * edit URL (`/creators/<publicId>?created=1`).
 */
export const createCreatorViaUi = async (
  page: Page,
  input: CreateCreatorInput
): Promise<string> => {
  await page.goto(adminUrl("/creators/new"));
  await expect(
    page.getByRole("heading", { name: "Create author" })
  ).toBeVisible();

  const fields = creatorFormFields(page);
  await fillField(fields.name, input.name);
  if (input.profileText !== undefined) {
    await fillField(fields.profileText, input.profileText);
  }

  await page.getByRole("button", { name: "Create author" }).click();
  // Must not match the create path `/creators/new` — that already looks like a
  // creator detail URL to a naive `/creators/[^/]+` pattern.
  await page.waitForURL((url) => {
    const match = url.pathname.match(
      /^\/creators\/(?<publicId>[^/]+)(?:\/|$)/u
    );
    const publicId = match?.groups?.publicId;
    return Boolean(publicId && publicId !== "new");
  });

  const match = page.url().match(/\/creators\/(?<publicId>[^/?#]+)/u);
  const publicId = match?.groups?.publicId?.trim() ?? "";
  if (!publicId || publicId === "new") {
    throw new Error(`could not parse creator public id from ${page.url()}`);
  }
  return publicId;
};

export interface CreatePageInput {
  /** Admin form input; stored and displayed as `/slug`. */
  slug: string;
  title: string;
  /** First version's body. Omitted leaves the page with no version at all. */
  contentMarkdown?: string;
  /** Footer link once published. Off by default, like the form itself. */
  displayInFooter?: boolean;
}

export interface PageFormFields {
  slug: Locator;
  title: Locator;
  body: Locator;
  displayInFooter: Locator;
}

/**
 * Fields of the page create form on the page the router currently shows.
 *
 * Role locators for the same reason as {@link seriesFormFields}: the router
 * bfcache keeps a previously visited form mounted inside a hidden
 * `<Activity>`, and only the one in front of the user is in the accessibility
 * tree.
 */
export const pageFormFields = (page: Page): PageFormFields => ({
  body: page.getByRole("textbox", { name: "Content" }),
  displayInFooter: page.getByRole("checkbox", { name: "Show in footer" }),
  slug: page.getByRole("textbox", { name: "slug" }),
  title: page.getByRole("textbox", { name: "Title" }),
});

/**
 * Fill and submit the page create form. Resolves after the redirect to the
 * edit URL (`/pages/<pageId>?created=1`) and returns the page id, which is the
 * row's uuid rather than a Base58 public_id.
 */
export const createPageViaUi = async (
  page: Page,
  input: CreatePageInput
): Promise<string> => {
  await page.goto(adminUrl("/pages/new"));
  await expect(
    page.getByRole("heading", { name: "Create page" })
  ).toBeVisible();

  const fields = pageFormFields(page);
  await fillField(fields.slug, input.slug);
  await fillField(fields.title, input.title);
  if (input.contentMarkdown !== undefined) {
    await fillField(fields.body, input.contentMarkdown);
  }
  if (input.displayInFooter === true) {
    await fields.displayInFooter.check();
  }

  await page.getByRole("button", { name: "Create page" }).click();
  // Must not match the create path `/pages/new` — that already looks like a
  // page detail URL to a naive `/pages/[^/]+` pattern.
  await page.waitForURL((url) => {
    const match = url.pathname.match(/^\/pages\/(?<pageId>[^/]+)(?:\/|$)/u);
    const pageId = match?.groups?.pageId;
    return Boolean(pageId && pageId !== "new");
  });

  const match = page.url().match(/\/pages\/(?<pageId>[^/?#]+)/u);
  const pageId = match?.groups?.pageId?.trim() ?? "";
  if (!pageId || pageId === "new") {
    throw new Error(`could not parse page id from ${page.url()}`);
  }
  return pageId;
};

export const formMessage = (page: Page): Locator =>
  // FormMessage renders a <p role="status">.
  page.getByRole("status");
