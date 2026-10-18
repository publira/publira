import { STRIPE_BASE_URL } from "./urls";

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
  const { secret } = (await response.json()) as { secret: string };
  return secret;
};
