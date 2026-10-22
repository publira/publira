import path from "node:path";

import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { applyScenarioSql, querySql } from "../src/db";
import { STUB_PUSH_ENDPOINT, stubPushApi } from "../src/push";
import {
  MEMBER_SETTINGS_MEMBER,
  MEMBER_SETTINGS_NEW_EMAIL,
  MEMBER_SETTINGS_NEW_PASSWORD,
  MEMBER_SETTINGS_SCENARIO,
  MEMBER_SETTINGS_SERIES,
} from "../src/scenarios/member-settings";
import { expectSessionRevokedFlash } from "../src/session";
import {
  openStorefrontUserMenu,
  signInAsMember,
  signOutStorefront,
} from "../src/storefront";
import { storefrontPath, WEB_STOREFRONT_BASE_URL } from "../src/urls";

const storefrontUrl = (pathname: string): string =>
  `${WEB_STOREFRONT_BASE_URL}${storefrontPath(pathname)}`;

const RENAMED_DISPLAY_NAME = "Renamed Settings Member";

/** A square photograph well above the 128px the API stores an icon from. */
const ICON_FIXTURE = path.join(
  import.meta.dirname,
  "../fixtures/eye-catch/square-1200x1200.jpg"
);

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

const memberField = (
  column: "email" | "icon_image_id" | "name" | "password_hash"
): string =>
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

const FOLLOWED_EPISODES = "New episodes of series and episodes you follow";
const FOLLOWED_CREATORS = "New episodes by authors you follow";

/** Every switch of the notification grid, as its row and column name it. */
const NOTIFICATION_CELLS = [
  [FOLLOWED_EPISODES, "Inbox"],
  [FOLLOWED_EPISODES, "Browser"],
  [FOLLOWED_EPISODES, "Mobile app"],
  [FOLLOWED_CREATORS, "Inbox"],
  [FOLLOWED_CREATORS, "Browser"],
  [FOLLOWED_CREATORS, "Mobile app"],
  ["Your comments", "Inbox"],
  ["Announcements", "Inbox"],
] as const;

const notificationCell = (
  page: Page,
  category: string,
  channel: string
): Locator =>
  page
    .getByRole("group", { name: category })
    .getByRole("switch", { name: channel });

/**
 * Turn one cell of the notification grid off. The grid is a Client Component
 * the server already drew, so a press that lands before it hydrates reaches no
 * listener; the switch is pressed again only while it still reports itself on,
 * so a retry never turns back on a cell that did move.
 */
const turnCellOff = async (cell: Locator): Promise<void> => {
  await expect(async () => {
    if ((await cell.getAttribute("aria-checked")) === "true") {
      await cell.click();
    }
    await expect(cell).not.toBeChecked({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
};

/**
 * The member area: My Page and the four `/settings` tabs.
 *
 * Every test here rewrites the account it signs in as — the display name, the
 * notification preferences, the follow list, the password, the browser this
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
 * `/settings/security` carries both an email change and a password change. What
 * the email form is asserted on here is the gate in front of the send: a wrong
 * current password is refused, the address stays put, and no change token is
 * left behind. The round trip a valid request starts — the two confirmation
 * links and the address the account ends up signing in with — belongs to
 * `storefront.email-change.spec.ts`, which owns an account of its own to move.
 * The password change is asserted end to end here instead, because what it
 * produces is a session rather than a link: the browser that made it stays
 * signed in, and every other one is turned away on its next request.
 */
test.describe("web-storefront member settings", () => {
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

    await openStorefrontUserMenu(page);
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

    await page.goto(storefrontUrl("/settings"));
    await expect(page.getByLabel("Display name")).toHaveValue(
      RENAMED_DISPLAY_NAME
    );
    expect(memberField("name")).toBe(RENAMED_DISPLAY_NAME);

    // The account menu in the site header is where the reader's own name is
    // shown now, so that is where a rename has to land.
    await page.goto(storefrontUrl("/my"));
    await openStorefrontUserMenu(page);
    await expect(
      page.getByRole("menu").getByText(RENAMED_DISPLAY_NAME)
    ).toBeVisible();
  });

  test("the basic settings screen sets, replaces, and removes the icon the header shows", async ({
    page,
  }) => {
    await signIn(page, "/settings");

    const accountMenu = page.getByRole("button", { name: "Account menu" });
    const settingsIcon = page.getByRole("img", { name: "Your icon" });
    // An account with no icon shows the stand-in in both places.
    await expect(
      page.getByRole("button", { name: "Upload icon" })
    ).toBeVisible();
    await expect(settingsIcon).toBeHidden();
    await expect(accountMenu.locator("img")).toHaveCount(0);

    await page.locator('input[type="file"]').setInputFiles(ICON_FIXTURE);

    await expectFlash(page, "status", "Your icon has been updated.");
    await expect(settingsIcon).toBeVisible();
    await expect(accountMenu.locator("img")).toBeVisible();
    const firstImage = memberField("icon_image_id");
    expect(firstImage).not.toBe("");
    // The image the page draws is one the edge actually serves.
    expect(
      await settingsIcon.evaluate(
        (image: HTMLImageElement) => image.naturalWidth
      )
    ).toBeGreaterThan(0);

    // Uploading again replaces the icon rather than asking to remove it first.
    await page.locator('input[type="file"]').setInputFiles(ICON_FIXTURE);
    await expectFlash(page, "status", "Your icon has been updated.");
    await expect.poll(() => memberField("icon_image_id")).not.toBe(firstImage);

    await page.reload();
    await expect(settingsIcon).toBeVisible();

    await page.getByRole("button", { name: "Remove icon" }).click();

    await expectFlash(page, "status", "Your icon has been removed.");
    await expect(settingsIcon).toBeHidden();
    await expect(accountMenu.locator("img")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Upload icon" })
    ).toBeVisible();
    expect(memberField("icon_image_id")).toBe("");
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

    await page.goto(storefrontUrl("/settings/notifications"));
    await expect(page.getByRole("checkbox")).not.toBeChecked();
  });

  test("the notification grid saves one cell off and leaves every other cell as it was", async ({
    page,
  }) => {
    await signIn(page, "/settings/notifications");

    await Promise.all(
      NOTIFICATION_CELLS.map(([category, channel]) =>
        expect(notificationCell(page, category, channel)).toBeChecked()
      )
    );
    await turnCellOff(notificationCell(page, "Announcements", "Inbox"));
    await page.getByRole("button", { name: "Save" }).click();

    await expectFlash(
      page,
      "status",
      "Your notification settings have been updated."
    );

    await page.goto(storefrontUrl("/settings/notifications"));
    await expect(
      notificationCell(page, "Announcements", "Inbox")
    ).not.toBeChecked();
    await Promise.all(
      NOTIFICATION_CELLS.filter(
        ([category]) => category !== "Announcements"
      ).map(([category, channel]) =>
        expect(notificationCell(page, category, channel)).toBeChecked()
      )
    );
  });

  test("a column heading turns a mixed column on, and off again once it is all on", async ({
    page,
  }) => {
    await signIn(page, "/settings/notifications");

    const browserColumn = page.getByRole("button", {
      exact: true,
      name: "Browser",
    });
    const episodes = notificationCell(page, FOLLOWED_EPISODES, "Browser");
    const creators = notificationCell(page, FOLLOWED_CREATORS, "Browser");

    await turnCellOff(episodes);
    await expect(creators).toBeChecked();

    await browserColumn.click();
    await expect(episodes).toBeChecked();
    await expect(creators).toBeChecked();

    await browserColumn.click();
    await expect(episodes).not.toBeChecked();
    await expect(creators).not.toBeChecked();
    await page.getByRole("button", { name: "Save" }).click();

    await expectFlash(
      page,
      "status",
      "Your notification settings have been updated."
    );

    await page.goto(storefrontUrl("/settings/notifications"));
    await expect(episodes).not.toBeChecked();
    await expect(creators).not.toBeChecked();
    await expect(
      notificationCell(page, FOLLOWED_EPISODES, "Inbox")
    ).toBeChecked();
  });

  test("the browser notification switch registers this browser and takes it off again", async ({
    page,
  }) => {
    await stubPushApi(page, "granted");
    await signIn(page, "/settings/notifications");

    const browserNotifications = page.getByRole("switch", {
      name: "Receive push notifications in this browser",
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
      name: "Receive push notifications in this browser",
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
      .getByRole("switch", {
        name: "Receive push notifications in this browser",
      })
      .click();
    await expect.poll(webPushDeviceCount).toBe("1");

    await signOutStorefront(page);

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
      await page.goto(storefrontUrl("/my"));
      await expect(
        page.getByRole("heading", { name: "Reading history" })
      ).toBeVisible();

      // `/settings` is where a revoked session surfaces: it calls GetMe through
      // `withPublicSessionReauth`, which turns the rejection into the re-login.
      await otherPage.goto(storefrontUrl("/settings"));
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

    await page.goto(storefrontUrl("/settings/follows"));
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

    await page.goto(storefrontUrl("/settings/follows"));
    await expect(
      page.getByRole("link", { name: MEMBER_SETTINGS_SERIES.title })
    ).toHaveCount(0);

    await page.goto(storefrontUrl(seriesPath));
    await expect(
      page.getByRole("button", { exact: true, name: followLabel })
    ).toBeVisible();
  });

  for (const memberPath of MEMBER_PATHS) {
    test(`${memberPath} redirects to login while signed out and returns after signing in`, async ({
      page,
    }) => {
      await page.goto(storefrontUrl(memberPath));

      await expect(page).toHaveURL(
        new RegExp(`/login\\?returnTo=${encodeURIComponent(memberPath)}$`, "u")
      );

      await signIn(page, memberPath);
      await expect(page).toHaveURL(new RegExp(`${memberPath}/?$`, "u"));
    });
  }
});
