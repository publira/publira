import type { Page } from "@playwright/test";

import { SEED_MEMBER } from "./scenarios/member-announcements";
import { fillLoginForm } from "./session";
import { hostPath, WEB_HOST_BASE_URL } from "./urls";

const hostUrl = (pathname: string): string =>
  `${WEB_HOST_BASE_URL}${hostPath(pathname)}`;

export const signInAsMember = async (
  page: Page,
  credentials: { email: string; password: string } = SEED_MEMBER,
  returnTo = "/my"
): Promise<void> => {
  const next = encodeURIComponent(returnTo);
  await page.goto(hostUrl(`/login?returnTo=${next}`));
  await fillLoginForm(page, credentials);
  await page.waitForURL((url) => !url.pathname.endsWith("/login"));
};

export const signInAsSeedMember = async (
  page: Page,
  returnTo = "/my"
): Promise<void> => {
  await signInAsMember(page, SEED_MEMBER, returnTo);
};

/** Open the public site's header account menu. */
export const openHostUserMenu = async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: "アカウントメニュー" }).click();
};

export const signOutHost = async (page: Page): Promise<void> => {
  await openHostUserMenu(page);
  await page.getByRole("menuitem", { name: "ログアウト" }).click();
  await page.waitForURL((url) => url.pathname.endsWith("/login"));
};
