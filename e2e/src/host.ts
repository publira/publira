import type { Page } from "@playwright/test";

import { SEED_MEMBER } from "./scenarios/member-announcements";
import { NOTIFICATION_INBOX_MEMBER } from "./scenarios/notification-inbox";
import { fillLoginForm } from "./session";
import {
  hostPath,
  WEB_HOST_BASE_URL,
  WEB_HOST_NOTIFICATION_INBOX_BASE_URL,
} from "./urls";

const hostUrl = (pathname: string, baseUrl = WEB_HOST_BASE_URL): string =>
  `${baseUrl}${hostPath(pathname)}`;

export const signInAsMember = async (
  page: Page,
  credentials: { email: string; password: string } = SEED_MEMBER,
  returnTo = "/my",
  baseUrl = WEB_HOST_BASE_URL
): Promise<void> => {
  const next = encodeURIComponent(returnTo);
  await page.goto(hostUrl(`/login?returnTo=${next}`, baseUrl));
  await fillLoginForm(page, credentials);
  await page.waitForURL((url) => !url.pathname.endsWith("/login"));
};

export const signInAsSeedMember = async (
  page: Page,
  returnTo = "/my"
): Promise<void> => {
  await signInAsMember(page, SEED_MEMBER, returnTo);
};

/** Sign in as the inbox tenant's member, on that tenant's own public site. */
export const signInAsNotificationInboxMember = async (
  page: Page,
  returnTo = "/my"
): Promise<void> => {
  await signInAsMember(
    page,
    NOTIFICATION_INBOX_MEMBER,
    returnTo,
    WEB_HOST_NOTIFICATION_INBOX_BASE_URL
  );
};

/** Open the public site's header account menu. */
export const openHostUserMenu = async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: "Account menu" }).click();
};

export const signOutHost = async (page: Page): Promise<void> => {
  await openHostUserMenu(page);
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL((url) => url.pathname.endsWith("/login"));
};
