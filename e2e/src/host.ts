import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

import { ANNOUNCEMENT_BANNER_MEMBER } from "./scenarios/announcement-banner";
import { ANNOUNCEMENT_DELIVERY_MEMBER } from "./scenarios/announcement-delivery";
import { SEED_MEMBER } from "./scenarios/member-announcements";
import { NOTIFICATION_INBOX_MEMBER } from "./scenarios/notification-inbox";
import { fillLoginForm } from "./session";
import {
  hostPath,
  WEB_HOST_ANNOUNCEMENT_BANNER_BASE_URL,
  WEB_HOST_ANNOUNCEMENT_DELIVERY_BASE_URL,
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

/** Sign in as the banner tenant's reader, on that tenant's own public site. */
export const signInAsAnnouncementBannerMember = async (
  page: Page,
  returnTo = "/my"
): Promise<void> => {
  await signInAsMember(
    page,
    ANNOUNCEMENT_BANNER_MEMBER,
    returnTo,
    WEB_HOST_ANNOUNCEMENT_BANNER_BASE_URL
  );
};

/** Sign in as the delivery tenant's reader, on that tenant's own public site. */
export const signInAsAnnouncementDeliveryMember = async (
  page: Page,
  returnTo = "/my"
): Promise<void> => {
  await signInAsMember(
    page,
    ANNOUNCEMENT_DELIVERY_MEMBER,
    returnTo,
    WEB_HOST_ANNOUNCEMENT_DELIVERY_BASE_URL
  );
};

/**
 * Open the public site's header account menu and leave it open.
 *
 * A press that lands before the header is hydrated reaches no listener and
 * opens nothing, which a page that has just navigated — a form's redirect
 * back with its message, say — makes likely. The trigger is pressed again
 * only while it still reports itself closed, so a retry never closes a menu
 * that did open.
 */
export const openHostUserMenu = async (page: Page): Promise<void> => {
  const trigger = page.getByRole("button", { name: "Account menu" });
  await expect(async () => {
    if ((await trigger.getAttribute("aria-expanded")) !== "true") {
      await trigger.click();
    }
    await expect(trigger).toHaveAttribute("aria-expanded", "true", {
      timeout: 1000,
    });
  }).toPass({ timeout: 15_000 });
};

export const signOutHost = async (page: Page): Promise<void> => {
  await openHostUserMenu(page);
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL((url) => url.pathname.endsWith("/login"));
};
