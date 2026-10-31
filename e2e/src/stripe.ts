import { STRIPE_BASE_URL } from "./urls";

/** The part of a webhook endpoint the stand-in answers that a scenario reads. */
interface StripeWebhookEndpoint {
  secret: string;
}

/** The part of a Price the stand-in answers that a scenario reads. */
interface StripePrice {
  id: string;
}

/**
 * Register `url` with the Stripe stand-in as the webhook endpoint of the
 * account `secretKey` names, for every event, and answer the signing secret
 * the stand-in signs its events to it with, which the tenant stores beside the
 * key as an operator stores the one Stripe's dashboard shows.
 */
export const registerStripeWebhook = async (
  secretKey: string,
  url: string
): Promise<string> => {
  const response = await fetch(`${STRIPE_BASE_URL}/v1/webhook_endpoints`, {
    body: new URLSearchParams({ "enabled_events[]": "*", url }),
    headers: { authorization: `Bearer ${secretKey}` },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(
      `the Stripe stand-in refused the webhook endpoint: ${response.status}`
    );
  }

  // SAFETY: the webhook endpoint e2e/scripts/stripe.ts answers
  // `POST /v1/webhook_endpoints` with.
  const { secret } = (await response.json()) as StripeWebhookEndpoint;

  return secret;
};

/**
 * Make `id` a payment intent the account `secretKey` names was paid `amount`
 * on in `currency`, with nothing refunded of it, so that a refund the console
 * asks for the purchase a scenario seeded with that payment ID is made.
 */
export const registerStripePaymentIntent = async (
  secretKey: string,
  payment: { amount: number; currency: string; id: string }
): Promise<void> => {
  const response = await fetch(`${STRIPE_BASE_URL}/payment-intents`, {
    body: JSON.stringify(payment),
    headers: { authorization: `Bearer ${secretKey}` },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(
      `the Stripe stand-in refused the payment intent: ${response.status}`
    );
  }
};

/**
 * Make a recurring Price on the account `secretKey` names, billed `amount` in
 * `currency` every `intervalCount` `interval`s, and answer its id, which a
 * subscription plan is saved with as an operator copies it from Stripe's
 * dashboard. `name` names the product it is a Price of, which heads the
 * checkout page of a plan billed at it.
 */
export const createStripePrice = async (
  secretKey: string,
  price: {
    amount: number;
    currency: string;
    interval: "day" | "month" | "week" | "year";
    intervalCount?: number;
    name?: string;
  }
): Promise<string> => {
  const body = new URLSearchParams({
    currency: price.currency,
    "recurring[interval]": price.interval,
    "recurring[interval_count]": String(price.intervalCount ?? 1),
    unit_amount: String(price.amount),
  });

  if (price.name) {
    body.set("product_data[name]", price.name);
  }

  const response = await fetch(`${STRIPE_BASE_URL}/v1/prices`, {
    body,
    headers: { authorization: `Bearer ${secretKey}` },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(
      `the Stripe stand-in refused the price: ${response.status}`
    );
  }

  // SAFETY: the Price e2e/scripts/stripe.ts answers `POST /v1/prices` with.
  const { id } = (await response.json()) as StripePrice;

  return id;
};
