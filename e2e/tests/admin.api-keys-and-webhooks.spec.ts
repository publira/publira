import { randomUUID } from "node:crypto";

import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { signInAsAdmin } from "../src/admin";
import { uniqueCommentBody } from "../src/comments";
import { applyScenarioSql } from "../src/db";
import {
  nudgeScheduledEpisodeReady,
  waitUntilEpisodePublishedInDb,
} from "../src/publish";
import {
  WEBHOOKS_ADMIN,
  WEBHOOKS_EDITOR,
  WEBHOOKS_READER,
  WEBHOOKS_SCENARIO,
} from "../src/scenarios/webhooks";
import { mintAccessToken } from "../src/session";
import { PUBLIC_API_BASE_URL, WEB_ADMIN_WEBHOOKS_BASE_URL } from "../src/urls";
import {
  setWebhookReceiverSecret,
  webhookReceiverDeliveries,
  webhookReceiverEndpoint,
} from "../src/webhook-receiver";

/**
 * A tenant administrator handing the tenant's own systems an API key and a
 * webhook endpoint: the key and the signing secret are shown once and only
 * their start afterwards, a revoked key is refused, a key that writes the
 * catalog is named in the audit log by its own name, an `http` URL is refused
 * on the form, a test event that is given up can be resent, one sent to a
 * receiver arrives signed, an episode the key publishes, at once or once its
 * time passes, is announced to a receiver that subscribed to it, and so is an
 * episode the key takes off the site, by itself or by hiding its series, a
 * reader's comment once it appears, at once or once it is approved, and a
 * message a reader sends through the contact form.
 *
 * The worker the stack runs dials a public address and the receiver's alone,
 * `127.0.0.1`, so {@link ENDPOINT_URL} is on another loopback address: the
 * worker gives each delivery to it up at once, which is the dead delivery
 * **Resend** is offered on.
 */

const PAGE_PATH = "/integrations/api-keys-and-webhooks";
const TITLE = "API keys and webhooks";

/** The tenant of `800_webhooks.sql`, by the ID the admin API names it by. */
const TENANT_UUID = "018f1ac0-0001-7000-8000-000000000001";

const ENDPOINT_URL = "https://127.0.0.2:9/publira-e2e";

/** Apart for each run, since the receiver keeps what it was sent. */
const RECEIVER_NAME = randomUUID();
const RECEIVER_URL = webhookReceiverEndpoint(RECEIVER_NAME);

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

/** What the admin API answers `procedure` for the tenant with `key`. */
const callAdminApi = (
  key: string,
  procedure: string,
  body: Readonly<Record<string, string>> = {}
): Promise<Response> =>
  fetch(`${PUBLIC_API_BASE_URL}/publira.admin.v1.${procedure}`, {
    body: JSON.stringify({ ...body, tenant: { tenantId: TENANT_UUID } }),
    headers: {
      Authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    method: "POST",
  });

/** The status the admin API answers `procedure` for the tenant with `key`. */
const adminApiStatus = async (
  key: string,
  procedure: string,
  body: Readonly<Record<string, string>> = {}
): Promise<number> => {
  const response = await callAdminApi(key, procedure, body);

  return response.status;
};

/** The body the admin API answers `procedure` with, failing on any refusal. */
const adminApiJson = async <T>(
  key: string,
  procedure: string,
  body: Readonly<Record<string, string>>
): Promise<T> => {
  const response = await callAdminApi(key, procedure, body);

  expect(response.status, await response.clone().text()).toBe(200);

  // SAFETY: the Connect JSON body of `procedure`'s response message, which
  // the caller names.
  return (await response.json()) as T;
};

/** The episode a `CreateEpisode` answer carries, as far as the suite reads it. */
interface CreatedEpisode {
  episode: { id: string; publicId: string; status: string };
}

/** Whether the admin API answers `ListLabels` for the tenant with `key`. */
const listLabelsWith = (key: string): Promise<number> =>
  adminApiStatus(key, "AdminLabelService/ListLabels");

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

    test("creates a key that writes the catalog, which the audit log names", async ({
      page,
    }) => {
      await openPage(page);
      const keys = section(page, "API keys");

      await keys.getByLabel("Name").fill("Editorial system");
      await keys
        .getByRole("checkbox", { exact: true, name: "Catalog changes" })
        .check();
      await keys.getByRole("button", { name: "Create API key" }).click();
      await expect(keys.getByText("Your new API key")).toBeVisible();

      const key = await textOf(keys.getByText(KEY_PATTERN));
      const prefix = key.slice(0, "pbk_".length + 12);

      // A write is what the scope admits, and a read is not.
      expect(
        await adminApiStatus(key, "AdminSeriesService/CreateSeries", {
          title: "Written by the editorial system",
        })
      ).toBe(200);
      expect(await listLabelsWith(key)).toBe(403);

      const entry = page
        .getByRole("row")
        .filter({ hasText: "Series created" })
        .filter({ hasText: "Editorial system" });

      // The entry is written by the audit log's asynchronous recorder.
      await expect(async () => {
        await page.goto(adminUrl("/audit-logs"));
        await expect(entry.first()).toBeVisible({ timeout: 5000 });
      }).toPass({ timeout: 30_000 });
      await expect(entry.first()).toContainText(`${prefix} / API key`);
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
      // endpoint is on a loopback address it was not told to allow.
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

    test("delivers a test event to a receiver, which verifies its signature", async ({
      page,
    }) => {
      await openPage(page);
      const form = addEndpointForm(page);

      await form.getByLabel("URL").fill(RECEIVER_URL);
      await form.getByRole("checkbox", { name: "Purchase completed" }).check();
      await form.getByRole("checkbox", { name: "Reader signed up" }).check();
      await form.getByRole("button", { name: "Add the endpoint" }).click();

      await expect(form.getByText("The endpoint was added.")).toBeVisible();
      await setWebhookReceiverSecret(
        RECEIVER_NAME,
        await textOf(form.getByText(SECRET_PATTERN))
      );

      await endpointRegion(page, RECEIVER_URL)
        .getByRole("button", { name: "Send test event" })
        .click();
      await expect(
        endpointRegion(page, RECEIVER_URL).getByText(
          "A test event was queued. It is listed under Deliveries."
        )
      ).toBeVisible();

      const testDelivery = section(page, "Deliveries")
        .getByRole("row")
        .filter({ hasText: "Test event" });

      await expect(async () => {
        await page.reload();
        await expect(testDelivery).toContainText("Delivered", {
          timeout: 3000,
        });
      }).toPass({ timeout: 60_000 });
      await expect(testDelivery).toContainText(RECEIVER_URL);
      await expect(testDelivery.getByRole("cell").nth(3)).toHaveText("1");

      const received = await webhookReceiverDeliveries(RECEIVER_NAME);

      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        body: { type: "webhook.test" },
        event: "webhook.test",
        verified: true,
      });
    });

    test("announces an episode published at once and one whose time passes to a receiver", async ({
      page,
    }) => {
      const receiverName = randomUUID();
      const receiverUrl = webhookReceiverEndpoint(receiverName);

      await openPage(page);
      const keys = section(page, "API keys");

      await keys.getByLabel("Name").fill("Publishing system");
      await keys
        .getByRole("checkbox", { exact: true, name: "Catalog changes" })
        .check();
      await keys.getByRole("button", { name: "Create API key" }).click();
      await expect(keys.getByText("Your new API key")).toBeVisible();

      const key = await textOf(keys.getByText(KEY_PATTERN));
      const form = addEndpointForm(page);

      await form.getByLabel("URL").fill(receiverUrl);
      await form.getByRole("checkbox", { name: "Episode published" }).check();
      await form.getByRole("button", { name: "Add the endpoint" }).click();
      await expect(form.getByText("The endpoint was added.")).toBeVisible();
      await setWebhookReceiverSecret(
        receiverName,
        await textOf(form.getByText(SECRET_PATTERN))
      );

      const { series } = await adminApiJson<{ series: { id: string } }>(
        key,
        "AdminSeriesService/CreateSeries",
        { title: "Announced series" }
      );

      // A time that has already passed publishes the episode as it is created.
      const atOnce = await adminApiJson<CreatedEpisode>(
        key,
        "AdminSeriesService/CreateEpisode",
        {
          scheduledAt: "2000-01-01T00:00:00Z",
          seriesId: series.id,
          title: "Published at once",
        }
      );

      expect(atOnce.episode.status).toBe("published");

      // One saved for later is published by the scheduled publication job once
      // its time is moved into the past.
      const scheduled = await adminApiJson<CreatedEpisode>(
        key,
        "AdminSeriesService/CreateEpisode",
        {
          scheduledAt: "2999-01-01T00:00:00Z",
          seriesId: series.id,
          title: "Published on schedule",
        }
      );

      expect(scheduled.episode.status).toBe("scheduled");
      nudgeScheduledEpisodeReady(scheduled.episode.publicId);
      await waitUntilEpisodePublishedInDb(scheduled.episode.publicId);

      await expect
        .poll(
          async () => {
            const deliveries = await webhookReceiverDeliveries(receiverName);

            return deliveries.length;
          },
          { timeout: 60_000 }
        )
        .toBe(2);
      const received = await webhookReceiverDeliveries(receiverName);

      expect(
        received.map(({ body, event, verified }) => ({
          episode: body.data.episode_public_id,
          event,
          title: body.data.title,
          verified,
        }))
      ).toEqual(
        expect.arrayContaining([
          {
            episode: atOnce.episode.publicId,
            event: "episode.published",
            title: "Published at once",
            verified: true,
          },
          {
            episode: scheduled.episode.publicId,
            event: "episode.published",
            title: "Published on schedule",
            verified: true,
          },
        ])
      );

      const announced = section(page, "Deliveries")
        .getByRole("row")
        .filter({ hasText: "Episode published" })
        .filter({ hasText: receiverUrl });

      await expect(async () => {
        await page.reload();
        await expect(announced).toHaveCount(2, { timeout: 3000 });
        await expect(announced.filter({ hasText: "Delivered" })).toHaveCount(
          2,
          { timeout: 3000 }
        );
      }).toPass({ timeout: 60_000 });
    });

    test("announces an episode taken off the site and each episode of a hidden series to a receiver", async ({
      page,
    }) => {
      const receiverName = randomUUID();
      const receiverUrl = webhookReceiverEndpoint(receiverName);

      await openPage(page);
      const keys = section(page, "API keys");

      await keys.getByLabel("Name").fill("Withdrawing system");
      await keys
        .getByRole("checkbox", { exact: true, name: "Catalog changes" })
        .check();
      await keys.getByRole("button", { name: "Create API key" }).click();
      await expect(keys.getByText("Your new API key")).toBeVisible();

      const key = await textOf(keys.getByText(KEY_PATTERN));
      const form = addEndpointForm(page);

      await form.getByLabel("URL").fill(receiverUrl);
      await form.getByRole("checkbox", { name: "Episode unpublished" }).check();
      await form.getByRole("button", { name: "Add the endpoint" }).click();
      await expect(form.getByText("The endpoint was added.")).toBeVisible();
      await setWebhookReceiverSecret(
        receiverName,
        await textOf(form.getByText(SECRET_PATTERN))
      );

      const { series } = await adminApiJson<{ series: { id: string } }>(
        key,
        "AdminSeriesService/CreateSeries",
        { publishedAt: "2000-01-01T00:00:00Z", title: "Withdrawn series" }
      );

      const publish = (title: string): Promise<CreatedEpisode> =>
        adminApiJson<CreatedEpisode>(key, "AdminSeriesService/CreateEpisode", {
          scheduledAt: "2000-01-01T00:00:00Z",
          seriesId: series.id,
          title,
        });

      const draftAgain = await publish("Taken back to a draft");
      const hidden = await publish("Hidden with its series");

      // Emptying the episode's time takes it back to a draft.
      await adminApiJson(
        key,
        "AdminSeriesService/UpdateEpisodePublishSchedule",
        {
          episodeId: draftAgain.episode.id,
          scheduledAt: "",
        }
      );
      // Saving the series without a publication date hides it, and the
      // episode still published in it with it.
      await adminApiJson(key, "AdminSeriesService/UpdateSeries", {
        seriesId: series.id,
        title: "Withdrawn series",
      });

      await expect
        .poll(
          async () => {
            const deliveries = await webhookReceiverDeliveries(receiverName);

            return deliveries.length;
          },
          { timeout: 60_000 }
        )
        .toBe(2);
      const received = await webhookReceiverDeliveries(receiverName);

      expect(
        received.map(({ body, event, verified }) => ({
          episode: body.data.episode_public_id,
          event,
          verified,
          withdrawn: body.data.withdrawn,
        }))
      ).toEqual(
        expect.arrayContaining([
          {
            episode: draftAgain.episode.publicId,
            event: "episode.unpublished",
            verified: true,
            withdrawn: "episode",
          },
          {
            episode: hidden.episode.publicId,
            event: "episode.unpublished",
            verified: true,
            withdrawn: "series",
          },
        ])
      );

      const withdrawn = section(page, "Deliveries")
        .getByRole("row")
        .filter({ hasText: "Episode unpublished" })
        .filter({ hasText: receiverUrl });

      await expect(async () => {
        await page.reload();
        await expect(withdrawn).toHaveCount(2, { timeout: 3000 });
        await expect(withdrawn.filter({ hasText: "Delivered" })).toHaveCount(
          2,
          { timeout: 3000 }
        );
      }).toPass({ timeout: 60_000 });
    });

    test("announces a reader's comment posted at once and one approved to a receiver", async ({
      page,
    }) => {
      const receiverName = randomUUID();
      const receiverUrl = webhookReceiverEndpoint(receiverName);

      await openPage(page);
      const keys = section(page, "API keys");

      await keys.getByLabel("Name").fill("Commenting system");
      await keys
        .getByRole("checkbox", { exact: true, name: "Catalog changes" })
        .check();
      await keys.getByRole("button", { name: "Create API key" }).click();
      await expect(keys.getByText("Your new API key")).toBeVisible();

      const key = await textOf(keys.getByText(KEY_PATTERN));
      const form = addEndpointForm(page);

      await form.getByLabel("URL").fill(receiverUrl);
      await form.getByRole("checkbox", { name: "Comment posted" }).check();
      await form.getByRole("button", { name: "Add the endpoint" }).click();
      await expect(form.getByText("The endpoint was added.")).toBeVisible();
      await setWebhookReceiverSecret(
        receiverName,
        await textOf(form.getByText(SECRET_PATTERN))
      );

      const commentedEpisode = async (
        commentMode: string
      ): Promise<CreatedEpisode> => {
        const { series } = await adminApiJson<{ series: { id: string } }>(
          key,
          "AdminSeriesService/CreateSeries",
          {
            commentMode,
            publishedAt: "2000-01-01T00:00:00Z",
            title: `Commented series ${commentMode}`,
          }
        );

        return adminApiJson<CreatedEpisode>(
          key,
          "AdminSeriesService/CreateEpisode",
          {
            scheduledAt: "2000-01-01T00:00:00Z",
            seriesId: series.id,
            title: "Commented episode",
          }
        );
      };

      const immediate = await commentedEpisode("COMMENT_MODE_IMMEDIATE");
      const approved = await commentedEpisode("COMMENT_MODE_APPROVAL_REQUIRED");

      const readerToken = await mintAccessToken({
        audience: "public",
        subject: WEBHOOKS_READER.publicId,
        tenantId: TENANT_UUID,
      });

      const postComment = async (
        episode: CreatedEpisode,
        body: string
      ): Promise<string> => {
        const response = await fetch(
          `${PUBLIC_API_BASE_URL}/publira.v1.CommentService/PostEpisodeComment`,
          {
            body: JSON.stringify({
              body,
              episodeId: episode.episode.id,
              tenant: { tenantId: TENANT_UUID },
            }),
            headers: {
              Authorization: `Bearer ${readerToken}`,
              "content-type": "application/json",
            },
            method: "POST",
          }
        );

        expect(response.status, await response.clone().text()).toBe(200);

        // SAFETY: the Connect JSON body of PostEpisodeCommentResponse.
        const { comment } = (await response.json()) as {
          comment: { publicId: string };
        };

        return comment.publicId;
      };

      const immediateBody = uniqueCommentBody("Shown at once");
      const approvedBody = uniqueCommentBody("Shown once approved");
      const immediateComment = await postComment(immediate, immediateBody);
      const approvedComment = await postComment(approved, approvedBody);

      // The comment waiting for approval is owed nothing until a moderator
      // approves it under Comments.
      await page.goto(adminUrl("/comments"));
      await page
        .getByRole("row")
        .filter({ hasText: approvedBody })
        .getByRole("button", { exact: true, name: "Approve" })
        .click();
      await expect(page.getByText("The comment was published.")).toBeVisible();

      await expect
        .poll(
          async () => {
            const deliveries = await webhookReceiverDeliveries(receiverName);

            return deliveries.length;
          },
          { timeout: 60_000 }
        )
        .toBe(2);
      const received = await webhookReceiverDeliveries(receiverName);

      expect(
        received.map(({ body, event, verified }) => ({
          author: body.data.author_name,
          comment: body.data.comment_public_id,
          episode: body.data.episode_public_id,
          event,
          verified,
        }))
      ).toEqual(
        expect.arrayContaining([
          {
            author: WEBHOOKS_READER.name,
            comment: immediateComment,
            episode: immediate.episode.publicId,
            event: "comment.posted",
            verified: true,
          },
          {
            author: WEBHOOKS_READER.name,
            comment: approvedComment,
            episode: approved.episode.publicId,
            event: "comment.posted",
            verified: true,
          },
        ])
      );

      await openPage(page);

      const posted = section(page, "Deliveries")
        .getByRole("row")
        .filter({ hasText: "Comment posted" })
        .filter({ hasText: receiverUrl });

      await expect(async () => {
        await page.reload();
        await expect(posted).toHaveCount(2, { timeout: 3000 });
        await expect(posted.filter({ hasText: "Delivered" })).toHaveCount(2, {
          timeout: 3000,
        });
      }).toPass({ timeout: 60_000 });
    });

    test("announces a message a reader sends through the contact form to a receiver", async ({
      page,
    }) => {
      const receiverName = randomUUID();
      const receiverUrl = webhookReceiverEndpoint(receiverName);

      await openPage(page);
      const form = addEndpointForm(page);

      await form.getByLabel("URL").fill(receiverUrl);
      await form
        .getByRole("checkbox", { name: "Contact message received" })
        .check();
      await form.getByRole("button", { name: "Add the endpoint" }).click();
      await expect(form.getByText("The endpoint was added.")).toBeVisible();
      await setWebhookReceiverSecret(
        receiverName,
        await textOf(form.getByText(SECRET_PATTERN))
      );

      const readerToken = await mintAccessToken({
        audience: "public",
        subject: WEBHOOKS_READER.publicId,
        tenantId: TENANT_UUID,
      });

      const subject = `Webhook ${randomUUID()}`;

      const response = await fetch(
        `${PUBLIC_API_BASE_URL}/publira.v1.ContactService/SubmitContactMessage`,
        {
          body: JSON.stringify({
            body: "Episode 3 is still locked after I bought it.",
            replyToEmail: WEBHOOKS_READER.email,
            subject,
            tenant: { tenantId: TENANT_UUID },
          }),
          headers: {
            Authorization: `Bearer ${readerToken}`,
            "content-type": "application/json",
          },
          method: "POST",
        }
      );

      expect(response.status, await response.clone().text()).toBe(200);

      await expect
        .poll(
          async () => {
            const deliveries = await webhookReceiverDeliveries(receiverName);

            return deliveries.length;
          },
          { timeout: 60_000 }
        )
        .toBe(1);
      const received = await webhookReceiverDeliveries(receiverName);

      expect(
        received.map(({ body, event, verified }) => ({
          event,
          reader: body.data.reader_name,
          reply: body.data.reply,
          subject: body.data.subject,
          verified,
        }))
      ).toEqual([
        {
          event: "contact_message.received",
          reader: WEBHOOKS_READER.name,
          reply: false,
          subject,
          verified: true,
        },
      ]);

      await openPage(page);

      const sent = section(page, "Deliveries")
        .getByRole("row")
        .filter({ hasText: "Contact message received" })
        .filter({ hasText: receiverUrl });

      await expect(async () => {
        await page.reload();
        await expect(sent.filter({ hasText: "Delivered" })).toHaveCount(1, {
          timeout: 3000,
        });
      }).toPass({ timeout: 60_000 });
    });
  });
});
