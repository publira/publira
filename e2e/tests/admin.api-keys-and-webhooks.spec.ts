import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { signInAsAdmin } from "../src/admin";
import { applyScenarioSql } from "../src/db";
import {
  WEBHOOKS_ADMIN,
  WEBHOOKS_EDITOR,
  WEBHOOKS_SCENARIO,
} from "../src/scenarios/webhooks";
import { PUBLIC_API_BASE_URL, WEB_ADMIN_WEBHOOKS_BASE_URL } from "../src/urls";

/**
 * A tenant administrator handing the tenant's own systems an API key and a
 * webhook endpoint: the key and the signing secret are shown once and only
 * their start afterwards, a revoked key is refused, an `http` URL is refused
 * on the form, and a test event that is given up can be resent.
 *
 * The worker the stack runs dials only a public address, so the endpoint is
 * one on the loopback address: the worker gives each delivery to it up at
 * once, which is the dead delivery **Resend** is offered on.
 */

const PAGE_PATH = "/integrations/api-keys-and-webhooks";
const TITLE = "API keys and webhooks";

/** The tenant of `800_webhooks.sql`, by the ID the admin API names it by. */
const TENANT_UUID = "018f1ac0-0001-7000-8000-000000000001";

const ENDPOINT_URL = "https://127.0.0.1:9/publira-e2e";

const adminUrl = (pathname: string): string =>
  new URL(pathname, WEB_ADMIN_WEBHOOKS_BASE_URL).toString();

const KEY_PATTERN = /^pbk_[a-z2-7]{12}_\S+$/u;
const SECRET_PATTERN = /^whsec_[a-z2-7]+$/u;

const openPage = async (page: Page): Promise<void> => {
  await page.goto(adminUrl(PAGE_PATH));
  await expect(
    page.getByRole("heading", { exact: true, level: 1, name: TITLE })
  ).toBeVisible();
};

const section = (page: Page, heading: string) =>
  page
    .getByRole("main")
    .locator("section")
    .filter({
      has: page.getByRole("heading", { exact: true, level: 2, name: heading }),
    })
    .last();

/** The form that adds an endpoint, below the ones already saved. */
const addEndpointForm = (page: Page) =>
  section(page, "Webhook endpoints")
    .locator("form")
    .filter({
      has: page.getByRole("heading", {
        exact: true,
        level: 3,
        name: "Add an endpoint",
      }),
    });

/** The part of the screen that holds one saved endpoint, named by its URL. */
const endpointRegion = (page: Page, url: string) =>
  page.getByRole("region", { exact: true, name: url });

/** The text a locator holds, trimmed; empty when it holds none. */
const textOf = async (locator: Locator): Promise<string> =>
  ((await locator.textContent()) ?? "").trim();

/** Whether the admin API answers `ListLabels` for the tenant with `key`. */
const listLabelsWith = async (key: string): Promise<number> => {
  const response = await fetch(
    `${PUBLIC_API_BASE_URL}/publira.admin.v1.AdminLabelService/ListLabels`,
    {
      body: JSON.stringify({ tenant: { tenantId: TENANT_UUID } }),
      headers: {
        Authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      method: "POST",
    }
  );

  return response.status;
};

/** Reads the audit log until an entry for `action` appears. */
const expectAuditEntry = async (page: Page, action: string): Promise<void> => {
  const entry = page.getByRole("row").filter({ hasText: action });

  // The entry is written by the audit log's asynchronous recorder.
  await expect(async () => {
    await page.goto(adminUrl("/audit-logs"));
    await expect(entry.first()).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 30_000 });
  await expect(entry.first()).toContainText(WEBHOOKS_ADMIN.name);
};

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  applyScenarioSql(WEBHOOKS_SCENARIO);
});

test.afterAll(() => {
  applyScenarioSql(WEBHOOKS_SCENARIO);
});

test.describe("API keys and webhooks", () => {
  test("an editor is not shown the page", async ({ page }) => {
    await signInAsAdmin(
      page,
      WEBHOOKS_EDITOR,
      "/",
      WEB_ADMIN_WEBHOOKS_BASE_URL
    );

    await page.goto(adminUrl(PAGE_PATH));
    await expect(
      page.getByRole("heading", { name: "Page not found" })
    ).toBeVisible();
  });

  test.describe("as an administrator", () => {
    test.beforeEach(async ({ page }) => {
      await signInAsAdmin(
        page,
        WEBHOOKS_ADMIN,
        PAGE_PATH,
        WEB_ADMIN_WEBHOOKS_BASE_URL
      );
    });

    test("creates a key that is shown once, and revokes it", async ({
      page,
    }) => {
      await openPage(page);
      const keys = section(page, "API keys");

      // A request made with the key names the tenant by the ID shown here.
      await expect(keys.getByText(TENANT_UUID, { exact: true })).toBeVisible();

      await keys.getByLabel("Name").fill("Warehouse");
      await keys
        .getByRole("checkbox", { exact: true, name: "Catalog" })
        .check();
      await keys.getByRole("button", { name: "Create API key" }).click();

      await expect(keys.getByText("The API key was created.")).toBeVisible();
      await expect(keys.getByText("Your new API key")).toBeVisible();

      const key = await textOf(keys.getByText(KEY_PATTERN));

      expect(key).toMatch(KEY_PATTERN);
      const prefix = key.slice(0, "pbk_".length + 12);

      // The key reads what its scope admits.
      expect(await listLabelsWith(key)).toBe(200);

      // Reloading shows its start and nothing more.
      await page.reload();
      const row = keys.getByRole("row").filter({ hasText: "Warehouse" });
      await expect(row).toContainText(prefix);
      await expect(row).toContainText("Catalog");
      await expect(row).toContainText("Active");
      expect(await page.content()).not.toContain(key);

      await row.getByRole("button", { name: "Revoke Warehouse" }).click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Revoke the key" })
        .click();

      await expect(row).toContainText("Revoked");
      await expect(
        row.getByRole("button", { name: "Revoke Warehouse" })
      ).toHaveCount(0);
      expect(await listLabelsWith(key)).toBe(401);

      await expectAuditEntry(page, "API key revoked");
    });

    test("refuses a key with no scope on the form", async ({ page }) => {
      await openPage(page);
      const keys = section(page, "API keys");

      await keys.getByLabel("Name").fill("No scope");
      await keys.getByRole("button", { name: "Create API key" }).click();

      await expect(keys.getByText("Choose at least one scope.")).toBeVisible();
      await expect(keys.getByText("Your new API key")).toHaveCount(0);
    });

    test("refuses an http URL on the form", async ({ page }) => {
      await openPage(page);
      const form = addEndpointForm(page);

      await form.getByLabel("URL").fill("http://hooks.example.com/publira");
      await form.getByRole("checkbox", { name: "Purchase completed" }).check();
      await form.getByRole("button", { name: "Add the endpoint" }).click();

      await expect(
        form.getByText(
          "Enter an https URL with a host name, and without a user name, a password, or a fragment."
        )
      ).toBeVisible();
      await expect(
        endpointRegion(page, "http://hooks.example.com/publira")
      ).toHaveCount(0);
    });

    test("saves an endpoint with two events, sends it a test event, and resends it once it is dead", async ({
      page,
    }) => {
      await openPage(page);
      const form = addEndpointForm(page);

      await form.getByLabel("URL").fill(ENDPOINT_URL);
      await form.getByRole("checkbox", { name: "Purchase completed" }).check();
      await form.getByRole("checkbox", { name: "Reader signed up" }).check();
      await form.getByRole("button", { name: "Add the endpoint" }).click();

      await expect(form.getByText("The endpoint was added.")).toBeVisible();
      await expect(
        form.getByText("The endpoint's signing secret")
      ).toBeVisible();

      const secret = await textOf(form.getByText(SECRET_PATTERN));

      expect(secret).toMatch(SECRET_PATTERN);

      const endpoint = endpointRegion(page, ENDPOINT_URL);
      await expect(endpoint).toBeVisible();
      await expect(
        endpoint.getByRole("checkbox", { name: "Purchase completed" })
      ).toBeChecked();
      await expect(
        endpoint.getByRole("checkbox", { name: "Reader signed up" })
      ).toBeChecked();
      await expect(
        endpoint.getByRole("checkbox", { name: "Purchase refunded" })
      ).not.toBeChecked();

      // Reloading shows the secret's hint and never the secret.
      await page.reload();
      await expect(endpoint).toContainText(`whsec_••••••••${secret.slice(-4)}`);
      expect(await page.content()).not.toContain(secret);

      await endpoint.getByRole("button", { name: "Send test event" }).click();
      await expect(
        endpoint.getByText(
          "A test event was queued. It is listed under Deliveries."
        )
      ).toBeVisible();

      // The worker gives the delivery up on its first attempt, since the
      // endpoint is on the loopback address.
      const deliveries = section(page, "Deliveries");

      const testDelivery = deliveries
        .getByRole("row")
        .filter({ hasText: "Test event" });

      await expect(async () => {
        await page.goto(adminUrl(`${PAGE_PATH}?status=dead`));
        await expect(testDelivery).toHaveCount(1, { timeout: 3000 });
      }).toPass({ timeout: 60_000 });
      await expect(
        deliveries.getByRole("link", { name: "Dead" })
      ).toHaveAttribute("aria-current", "page");
      await expect(testDelivery).toContainText(ENDPOINT_URL);
      await expect(testDelivery).toContainText("Dead");
      await expect(testDelivery.getByRole("cell").nth(3)).toHaveText("1");

      await testDelivery.getByRole("button", { name: /^Resend /u }).click();

      // The row leaves Dead while the resend is owed, so the list itself is
      // what reports it: another attempt on the same delivery, given up again.
      await expect(async () => {
        await page.reload();
        await expect(testDelivery.getByRole("cell").nth(3)).toHaveText("2", {
          timeout: 3000,
        });
      }).toPass({ timeout: 60_000 });
      await expect(testDelivery).toContainText("Dead");

      await expectAuditEntry(page, "Webhook delivery resent");
    });

    test("rotates an endpoint's secret and shows the new one once", async ({
      page,
    }) => {
      await openPage(page);
      const endpoint = endpointRegion(page, ENDPOINT_URL);
      const hint = await textOf(endpoint.getByText(/^whsec_•+/u));

      await endpoint.getByRole("button", { name: "Rotate secret" }).click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Rotate the secret" })
        .click();

      await expect(endpoint.getByText("The new signing secret")).toBeVisible();

      const secret = await textOf(endpoint.getByText(SECRET_PATTERN));

      expect(secret).toMatch(SECRET_PATTERN);
      await expect(endpoint).toContainText(`whsec_••••••••${secret.slice(-4)}`);
      expect(await textOf(endpoint.getByText(/^whsec_•+/u))).not.toBe(hint);
    });

    test("deletes an endpoint with its deliveries", async ({ page }) => {
      await openPage(page);
      const endpoint = endpointRegion(page, ENDPOINT_URL);

      await endpoint.getByRole("button", { name: "Delete" }).click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Delete the endpoint" })
        .click();

      await expect(endpoint).toHaveCount(0);
      await expect(
        section(page, "Deliveries").getByRole("row").filter({
          hasText: ENDPOINT_URL,
        })
      ).toHaveCount(0);
    });
  });
});
