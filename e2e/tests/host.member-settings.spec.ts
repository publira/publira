import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { applyScenarioSql, querySql } from "../src/db";
import { openHostUserMenu, signInAsMember, signOutHost } from "../src/host";
import { STUB_PUSH_ENDPOINT, stubPushApi } from "../src/push";
import {
  MEMBER_SETTINGS_MEMBER,
  MEMBER_SETTINGS_NEW_EMAIL,
  MEMBER_SETTINGS_NEW_PASSWORD,
  MEMBER_SETTINGS_SCENARIO,
  MEMBER_SETTINGS_SERIES,
} from "../src/scenarios/member-settings";
import { expectSessionRevokedFlash } from "../src/session";
import { hostPath, WEB_HOST_BASE_URL } from "../src/urls";

const hostUrl = (pathname: string): string =>
  `${WEB_HOST_BASE_URL}${hostPath(pathname)}`;

const RENAMED_DISPLAY_NAME = "Renamed Settings Member";

/** Every screen the member area keeps behind a session. */
const MEMBER_PATHS = [
  "/my",
  "/settings",
  "/settings/follows",
  "/settings/notifications",
  "/settings/security",
] as const;

const signIn = (page: Page, returnTo: string): Promise<void> =>
  signInAsMember(page, MEMBER_SETTINGS_MEMBER, returnTo);

const memberField = (column: "email" | "name" | "password_hash"): string =>
  querySql(
    `SELECT ${column} FROM users WHERE public_id = '${MEMBER_SETTINGS_MEMBER.publicId}';`
  );

/**
 * Live regions expose their copy as contents, not as an accessible name, and
 * `getByRole("alert")` also matches Next.js's route announcer.
 */
const expectFlash = (
  page: Page,
  role: "alert" | "status",
  message: string
): Promise<void> =>
  expect(page.getByRole(role).filter({ hasText: message })).toBeVisible();

/**
 * The two forms on `/settings/security` both ask for the current password, so
 * a bare `getByLabel("Current password")` matches twice. Each section names
 * itself after its heading, which is what these scope to.
 */
const emailChangeSection = (page: Page) =>
  page.getByRole("region", { name: "Change email address" });

const passwordChangeSection = (page: Page) =>
  page.getByRole("region", { name: "Change password" });

const emailChangeTokenCount = (): string =>
  querySql(`
    SELECT COUNT(*)
    FROM user_email_change_tokens t
    JOIN users u ON u.id = t.user_id
    WHERE u.public_id = '${MEMBER_SETTINGS_MEMBER.publicId}';
  `);

/** What the server holds for this member's browser, if anything. */
const webPushDevices = (column: string): string =>
  querySql(`
    SELECT ${column}
    FROM user_push_devices d
    JOIN users u ON u.id = d.user_id
    WHERE u.public_id = '${MEMBER_SETTINGS_MEMBER.publicId}'
      AND d.platform = 'web';
  `);

const webPushDeviceCount = (): string => webPushDevices("COUNT(*)");
const webPushEndpoint = (): string => webPushDevices("d.endpoint");

/**
 * The member area: My Page and the four `/settings` tabs.
 *
 * Every test here rewrites the account it signs in as — the display name, the
 * notification preference, the follow list, the password, the browser this
 * reader has registered for push — so the suite owns a member no other spec
 * signs in as, and re-applies its scenario afterwards to put the starting
 * values back. `mode: "serial"` stops a failed write from being read back as a
 * pass by the test after it. The password test re-applies that scenario itself
 * rather than waiting for `afterAll`, because every test after it signs in with
 * the password it moved off.
 *
 * The browser notification tests stand in for the Push API rather than using
 * Chromium's own: a permission prompt has no answer a test can give, and a real
 * subscription is a round trip to Google's push service. What is asserted is
 * everything on this side of it — the registration the server stores, the line a
 * refusal shows, and the row signing out takes away.
 *
 * `/settings/security` carries both an email change and a password change.
 * What the email form is asserted on here is the gate in front of the send: a
 * wrong current password is refused, the address stays put, and no change
 * token is left behind. The round trip a valid request starts — the two
 * confirmation links and the address the account ends up signing in with —
 * belongs to `host.email-change.spec.ts`, which owns an account of its own to
 * move. The password change is asserted end to end here instead, because what
 * it produces is a session rather than a link: the browser that made it stays
 * signed in, and every other one is turned away on its next request.
 */
test.describe("web-host member settings", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(() => {
    applyScenarioSql(MEMBER_SETTINGS_SCENARIO);
  });

  test.afterAll(() => {
    applyScenarioSql(MEMBER_SETTINGS_SCENARIO);
  });

  test("My Page opens with the reader's follows and names them in the account menu", async ({
    page,
  }) => {
    await signIn(page, "/my");

    await expect(
      page.getByRole("heading", { level: 1, name: "My Page" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "New from your follows" })
    ).toBeVisible();
    // Nothing on the screen tells the reader who they are any more: the name
    // is in the account menu, and the rest is on `/settings`.
    await expect(page.getByText(MEMBER_SETTINGS_MEMBER.publicId)).toBeHidden();

    await openHostUserMenu(page);
    await expect(
      page.getByRole("menu").getByText(MEMBER_SETTINGS_MEMBER.name)
    ).toBeVisible();
  });

  test("the basic settings screen saves a display name that survives a reload", async ({
    page,
  }) => {
    await signIn(page, "/settings");

    const nameField = page.getByLabel("Display name");
    await expect(nameField).toHaveValue(MEMBER_SETTINGS_MEMBER.name);
    await nameField.fill(RENAMED_DISPLAY_NAME);
    await page.getByRole("button", { name: "Save" }).click();

    await expectFlash(page, "status", "Your profile has been updated.");

    await page.goto(hostUrl("/settings"));
    await expect(page.getByLabel("Display name")).toHaveValue(
      RENAMED_DISPLAY_NAME
    );
    expect(memberField("name")).toBe(RENAMED_DISPLAY_NAME);

    // The account menu in the site header is where the reader's own name is
    // shown now, so that is where a rename has to land.
    await page.goto(hostUrl("/my"));
    await openHostUserMenu(page);
    await expect(
      page.getByRole("menu").getByText(RENAMED_DISPLAY_NAME)
    ).toBeVisible();
  });

  test("the notification screen turns email notifications off and keeps them off", async ({
    page,
  }) => {
    await signIn(page, "/settings/notifications");

    const emailNotifications = page.getByRole("checkbox");
    await expect(emailNotifications).toBeChecked();
    await emailNotifications.uncheck();
    await page.getByRole("button", { name: "Save" }).click();

    await expectFlash(
      page,
      "status",
      "Your notification settings have been updated."
    );

    await page.goto(hostUrl("/settings/notifications"));
    await expect(page.getByRole("checkbox")).not.toBeChecked();
  });

  test("the browser notification switch registers this browser and takes it off again", async ({
    page,
  }) => {
    await stubPushApi(page, "granted");
    await signIn(page, "/settings/notifications");

    const browserNotifications = page.getByRole("switch", {
      name: "New episode notifications",
    });
    await expect(browserNotifications).not.toBeChecked();
    expect(webPushDeviceCount()).toBe("0");

    // `click`, not `check`: the switch follows the registration rather than the
    // pointer, so it is still off when `check` verifies its own click.
    await browserNotifications.click();
    await expect(browserNotifications).toBeChecked();
    await expect.poll(webPushDeviceCount).toBe("1");
    expect(webPushEndpoint()).toBe(STUB_PUSH_ENDPOINT);

    await browserNotifications.click();
    await expect(browserNotifications).not.toBeChecked();
    await expect.poll(webPushDeviceCount).toBe("0");
  });

  test("a refused permission settles the switch back and points at browser settings", async ({
    page,
  }) => {
    await stubPushApi(page, "denied");
    await signIn(page, "/settings/notifications");

    const browserNotifications = page.getByRole("switch", {
      name: "New episode notifications",
    });
    await browserNotifications.click();

    await expect(
      page.getByText(
        "Notifications are turned off for this site. Turn them on in your browser settings."
      )
    ).toBeVisible();
    await expect(browserNotifications).not.toBeChecked();
    expect(webPushDeviceCount()).toBe("0");
  });

  test("signing out takes this browser off the delivery list", async ({
    page,
  }) => {
    await stubPushApi(page, "granted");
    await signIn(page, "/settings/notifications");

    await page
      .getByRole("switch", { name: "New episode notifications" })
      .click();
    await expect.poll(webPushDeviceCount).toBe("1");

    await signOutHost(page);

    await expect.poll(webPushDeviceCount).toBe("0");
  });

  test("the security screen refuses an email change whose current password is wrong", async ({
    page,
  }) => {
    await signIn(page, "/settings/security");

    const section = emailChangeSection(page);
    await expect(
      page.getByRole("heading", { name: "Change email address" })
    ).toBeVisible();
    await section
      .getByLabel("Current email address")
      .fill(MEMBER_SETTINGS_MEMBER.email);
    await section
      .getByLabel("New email address")
      .fill(MEMBER_SETTINGS_NEW_EMAIL);
    await section.getByLabel("Current password").fill("wrong-password");
    await section
      .getByRole("button", { name: "Send confirmation emails" })
      .click();

    await expectFlash(
      page,
      "alert",
      "Could not request the email change. Please check what you entered."
    );
    await expect(page).toHaveURL(/\/settings\/security/u);
    expect(memberField("email")).toBe(MEMBER_SETTINGS_MEMBER.email);
    expect(emailChangeTokenCount()).toBe("0");
  });

  test("the security screen refuses a password change whose current password is wrong", async ({
    page,
  }) => {
    await signIn(page, "/settings/security");
    const storedHash = memberField("password_hash");

    const section = passwordChangeSection(page);
    await section.getByLabel("Current password").fill("wrong-password");
    await section
      .getByLabel("New password", { exact: true })
      .fill(MEMBER_SETTINGS_NEW_PASSWORD);
    await section
      .getByLabel("Confirm new password")
      .fill(MEMBER_SETTINGS_NEW_PASSWORD);
    await section.getByRole("button", { name: "Change password" }).click();

    await expectFlash(
      page,
      "alert",
      "Could not change your password. Please check what you entered."
    );
    await expect(page).toHaveURL(/\/settings\/security/u);
    expect(memberField("password_hash")).toBe(storedHash);
  });

  test("a password change keeps this browser signed in and turns the other one away", async ({
    browser,
    page,
  }) => {
    const otherContext = await browser.newContext();
    const otherPage = await otherContext.newPage();
    try {
      await signInAsMember(otherPage, MEMBER_SETTINGS_MEMBER, "/my");
      await expect(
        otherPage.getByRole("heading", { name: "Reading history" })
      ).toBeVisible();

      await signIn(page, "/settings/security");
      const section = passwordChangeSection(page);
      await section
        .getByLabel("Current password")
        .fill(MEMBER_SETTINGS_MEMBER.password);
      await section
        .getByLabel("New password", { exact: true })
        .fill(MEMBER_SETTINGS_NEW_PASSWORD);
      await section
        .getByLabel("Confirm new password")
        .fill(MEMBER_SETTINGS_NEW_PASSWORD);
      await section.getByRole("button", { name: "Change password" }).click();

      await expectFlash(
        page,
        "status",
        "Your password has been changed. Your other devices have been signed out."
      );

      // The change ended the token this browser arrived with too; it is the
      // replacement the Action sealed into the cookie that keeps it signed in.
      await page.goto(hostUrl("/my"));
      await expect(
        page.getByRole("heading", { name: "Reading history" })
      ).toBeVisible();

      // `/settings` is where a revoked session surfaces: it calls GetMe through
      // `withPublicSessionReauth`, which turns the rejection into the re-login.
      await otherPage.goto(hostUrl("/settings"));
      await expectSessionRevokedFlash(otherPage);

      // The new password is the one that signs in now.
      await signInAsMember(
        otherPage,
        {
          email: MEMBER_SETTINGS_MEMBER.email,
          password: MEMBER_SETTINGS_NEW_PASSWORD,
        },
        "/my"
      );
      await expect(
        otherPage.getByRole("heading", { name: "Reading history" })
      ).toBeVisible();
    } finally {
      await otherContext.close();
      // Put the original password back before the tests that sign in with it.
      applyScenarioSql(MEMBER_SETTINGS_SCENARIO);
    }
  });

  test("following a series from its page lists it, and unfollowing clears both", async ({
    page,
  }) => {
    const seriesPath = `/series/${MEMBER_SETTINGS_SERIES.publicId}`;
    // `exact`: the unfollow label ends in the follow label, and a role name
    // given as a string is otherwise a case-insensitive substring match.
    const followLabel = `Follow ${MEMBER_SETTINGS_SERIES.title}`;
    const unfollowLabel = `Unfollow ${MEMBER_SETTINGS_SERIES.title}`;
    await signIn(page, seriesPath);

    await page.getByRole("button", { exact: true, name: followLabel }).click();
    await expect(page.getByText("You are now following this.")).toBeVisible();

    await page.goto(hostUrl("/settings/follows"));
    const entry = page.getByRole("article").filter({
      has: page.getByRole("link", { name: MEMBER_SETTINGS_SERIES.title }),
    });
    await expect(entry).toBeVisible();
    // `exact`: the entry's own link is `Seed Series 042`, which contains it.
    await expect(entry.getByText("Series", { exact: true })).toBeVisible();

    // The Action refreshes the follow island, so the entry — and the button's
    // own success message with it — is gone by the time the list re-renders.
    await entry.getByRole("button", { name: unfollowLabel }).click();
    await expect(entry).toHaveCount(0);
    await expect(
      page.getByText("You are not following any series or authors.")
    ).toBeVisible();

    await page.goto(hostUrl("/settings/follows"));
    await expect(
      page.getByRole("link", { name: MEMBER_SETTINGS_SERIES.title })
    ).toHaveCount(0);

    await page.goto(hostUrl(seriesPath));
    await expect(
      page.getByRole("button", { exact: true, name: followLabel })
    ).toBeVisible();
  });

  for (const memberPath of MEMBER_PATHS) {
    test(`${memberPath} redirects to login while signed out and returns after signing in`, async ({
      page,
    }) => {
      await page.goto(hostUrl(memberPath));

      await expect(page).toHaveURL(
        new RegExp(`/login\\?returnTo=${encodeURIComponent(memberPath)}$`, "u")
      );

      await signIn(page, memberPath);
      await expect(page).toHaveURL(new RegExp(`${memberPath}/?$`, "u"));
    });
  }
});
