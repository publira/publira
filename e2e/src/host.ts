import type { Page } from "@playwright/test";

import { SEED_MEMBER } from "./scenarios/member-announcements";
import { fillLoginForm } from "./session";
import { WEB_HOST_BASE_URL } from "./urls";

const hostUrl = (pathname: string): string => `${WEB_HOST_BASE_URL}${pathname}`;

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

export const signOutHost = async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: "Logout" }).click();
  await page.waitForURL((url) => url.pathname.endsWith("/login"));
};
