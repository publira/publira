import { randomUUID } from "node:crypto";

import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { applyScenarioSql, runSql } from "../src/db";
import { signInAsSeedPlatformSuperAdmin } from "../src/platform";
import {
  SUSPENSION_ADMIN,
  SUSPENSION_TENANT,
  TENANT_SUSPENSION_SCENARIO,
} from "../src/scenarios/tenant-suspension";
import { ADMIN_SESSION_COOKIE_NAME, plantSessionCookie } from "../src/session";
import {
  WEB_ADMIN_INTERNAL_URL,
  WEB_HOST_INTERNAL_URL,
  withHostname,
} from "../src/urls";

const SITE_UNAVAILABLE = "This site is unavailable";
const CONSOLE_UNAVAILABLE = "This admin console is unavailable";

/**
 * The tenant's site and console under host names made up for this attempt.
 *
 * The web apps keep a host they have resolved for minutes, and the suspension
 * only shows through once that runs out. Every attempt — a retry, a second run
 * against the same stack — therefore moves the tenant to hosts nothing has
 * looked up yet. No list of the edge's names them, so they are reached on the
 * apps' own ports.
 */
const moveTenantToFreshHosts = (): { console: string; site: string } => {
  const label = `suspend-${randomUUID()}`;
  const site = withHostname(WEB_HOST_INTERNAL_URL, `${label}.localhost`);
  const admin = withHostname(
    WEB_ADMIN_INTERNAL_URL,
    `admin.${label}.localhost`
  );
  runSql(`
    UPDATE tenants
    SET domain = '${new URL(site).host}',
        admin_domain = '${new URL(admin).host}'
    WHERE public_id = '${SUSPENSION_TENANT.publicId}';
  `);
  return { console: admin, site };
};

/**
 * A browser of its own for one visitor, so the reader, the staff member, and
 * the operator pressing the buttons hold no cookie of one another's.
 */
const openVisitor = async (
  browser: Browser
): Promise<{ context: BrowserContext; page: Page }> => {
  const context = await browser.newContext({ locale: "en-US" });
  return { context, page: await context.newPage() };
};

/** Open `url` and expect the `503` a suspended tenant answers with. */
const expectUnavailable = async (
  page: Page,
  url: string,
  heading: string
): Promise<void> => {
  const response = await page.goto(url);
  expect(response?.status(), url).toBe(503);
  expect(response?.headers()["cache-control"]).toBe("no-store");
  await expect(
    page.getByRole("heading", { level: 1, name: heading })
  ).toBeVisible();
};

/**
 * What a suspended tenant's readers and staff see, from the moment an operator
 * presses **Suspend** to the moment they press **Resume**.
 *
 * The tenant is one of its own (`480_tenant_suspension.sql`), on hosts never
 * opened before the suspension (`moveTenantToFreshHosts`). A suspended host is
 * never kept, which is why the site and the console answer again the moment
 * the tenant is resumed, and why the second half of this test needs no
 * waiting.
 */
test.describe("a suspended tenant", () => {
  test.beforeAll(() => {
    applyScenarioSql(TENANT_SUSPENSION_SCENARIO);
  });

  test.afterAll(() => {
    applyScenarioSql(TENANT_SUSPENSION_SCENARIO);
  });

  test("its site and console say they are unavailable, and work again once it is resumed", async ({
    browser,
    page,
  }) => {
    const hosts = moveTenantToFreshHosts();
    const siteUrl = (pathname: string): string => `${hosts.site}${pathname}`;
    const consoleUrl = (pathname: string): string =>
      `${hosts.console}${pathname}`;
    const reader = await openVisitor(browser);
    const staff = await openVisitor(browser);
    try {
      await plantSessionCookie(
        staff.page,
        ADMIN_SESSION_COOKIE_NAME,
        hosts.console,
        {
          audience: "admin",
          role: SUSPENSION_ADMIN.role,
          subject: SUSPENSION_ADMIN.publicId,
          tenantId: SUSPENSION_TENANT.id,
        }
      );

      await signInAsSeedPlatformSuperAdmin(
        page,
        `/tenants/${SUSPENSION_TENANT.publicId}`
      );
      await page.getByRole("button", { name: "Suspend" }).click();
      await expect(page.getByRole("button", { name: "Resume" })).toBeVisible({
        timeout: 30_000,
      });

      // Every page of the site, whatever it would have shown, and in the
      // language the URL names.
      await expectUnavailable(reader.page, siteUrl("/"), SITE_UNAVAILABLE);
      await expect(reader.page.getByText(SUSPENSION_TENANT.name)).toHaveCount(
        0
      );
      await expectUnavailable(
        reader.page,
        siteUrl("/series"),
        SITE_UNAVAILABLE
      );
      const localized = await reader.page.goto(siteUrl("/ja/series"));
      expect(localized?.status()).toBe(503);
      await expect(reader.page.locator("html")).toHaveAttribute("lang", "ja");

      // The console refuses the sign-in form and a session alike, and keeps the
      // session for when the tenant is back.
      await expectUnavailable(
        staff.page,
        consoleUrl("/login"),
        CONSOLE_UNAVAILABLE
      );
      await expect(staff.page.getByLabel(/Email address/u)).toHaveCount(0);
      await expectUnavailable(staff.page, consoleUrl("/"), CONSOLE_UNAVAILABLE);
      await expect(staff.page.getByText(/has been suspended/u)).toBeVisible();

      await page.getByRole("button", { name: "Resume" }).click();
      await expect(page.getByRole("button", { name: "Suspend" })).toBeVisible({
        timeout: 30_000,
      });

      const siteResponse = await reader.page.goto(siteUrl("/"));
      expect(siteResponse?.status(), await reader.page.content()).toBe(200);
      await expect(
        reader.page.getByRole("link", {
          exact: true,
          name: SUSPENSION_TENANT.name,
        })
      ).toBeVisible();

      const consoleResponse = await staff.page.goto(consoleUrl("/"));
      expect(consoleResponse?.status(), await staff.page.content()).toBe(200);
      await expect(
        staff.page.getByRole("heading", { exact: true, name: "Dashboard" })
      ).toBeVisible();
    } finally {
      await reader.context.close();
      await staff.context.close();
    }
  });
});
