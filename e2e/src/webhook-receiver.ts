import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import {
  WEBHOOK_RECEIVER_BASE_URL,
  WEBHOOK_RECEIVER_HTTPS_BASE_URL,
} from "./urls";

/** A delivery the stand-in for a tenant's receiver was sent. */
export interface WebhookReceiverDelivery {
  /**
   * The body, as JSON, with the fields of `data` the suite reads; an event
   * that carries none of them, such as `webhook.test`, leaves them out.
   */
  body: {
    data: {
      author_name?: string;
      bonus_coins?: number;
      coin_pack_public_id?: string;
      coins?: number;
      comment_public_id?: string;
      creator_public_ids?: string[];
      episode_public_id?: string;
      price?: number;
      reader_name?: string;
      reply?: boolean;
      subject?: string;
      title?: string;
      withdrawn?: string;
    };
    id: string;
    type: string;
  };
  /** `X-Publira-Delivery`. */
  delivery: string;
  /** `X-Publira-Event`. */
  event: string;
  /** Whether `X-Publira-Signature` verified against the secret set for it. */
  verified: boolean;
}

/** The URL a webhook endpoint saves to deliver to the receiver under `name`. */
export const webhookReceiverEndpoint = (name: string): string =>
  `${WEBHOOK_RECEIVER_HTTPS_BASE_URL}/${name}`;

/** Hands the receiver the signing secret deliveries to `name` are checked with. */
export const setWebhookReceiverSecret = async (
  name: string,
  secret: string
): Promise<void> => {
  const response = await fetch(
    `${WEBHOOK_RECEIVER_BASE_URL}/__e2e/secrets/${name}`,
    { body: secret, method: "PUT" }
  );

  if (!response.ok) {
    throw new Error(
      `the webhook receiver did not take the secret: ${response.status}`
    );
  }
};

/** Everything the receiver was sent under `name`, oldest first. */
export const webhookReceiverDeliveries = async (
  name: string
): Promise<WebhookReceiverDelivery[]> => {
  const response = await fetch(
    `${WEBHOOK_RECEIVER_BASE_URL}/__e2e/deliveries/${name}`
  );

  if (!response.ok) {
    throw new Error(
      `the webhook receiver did not answer its deliveries: ${response.status}`
    );
  }

  // SAFETY: the list of recorded deliveries e2e/scripts/webhook-receiver.ts
  // answers `GET /__e2e/deliveries/<name>` with.
  return (await response.json()) as WebhookReceiverDelivery[];
};

/**
 * Saves a webhook endpoint that delivers the event the console labels `event`
 * to the receiver under `name`, on the console at `adminBaseUrl` that `page`
 * is signed in to as the tenant's admin, and hands the receiver its signing
 * secret.
 */
export const subscribeWebhookReceiver = async (
  page: Page,
  adminBaseUrl: string,
  name: string,
  event: string
): Promise<void> => {
  await page.goto(
    new URL("/integrations/api-keys-and-webhooks", adminBaseUrl).toString()
  );

  const form = page.locator("form").filter({
    has: page.getByRole("heading", {
      exact: true,
      level: 3,
      name: "Add an endpoint",
    }),
  });

  await form.getByLabel("URL").fill(webhookReceiverEndpoint(name));
  await form.getByRole("checkbox", { name: event }).check();
  await form.getByRole("button", { name: "Add the endpoint" }).click();
  await expect(form.getByText("The endpoint was added.")).toBeVisible();
  const secret = form.getByText(/^whsec_[a-z2-7]+$/u);

  await setWebhookReceiverSecret(
    name,
    ((await secret.textContent()) ?? "").trim()
  );
};
