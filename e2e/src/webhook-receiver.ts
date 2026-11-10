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
      comment_public_id?: string;
      episode_public_id?: string;
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
