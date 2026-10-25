/**
 * Stands in for Stripe during an E2E run: the API calls publira server makes
 * to start a checkout, the hosted page a reader pays on, and the webhook that
 * reports the payment.
 *
 * publira server reaches the API through `PUBLIRA_STRIPE_API_URL`, which
 * `lib.sh` points here. A spec first registers the storefront's webhook URL
 * under the secret key it stores for the tenant, with
 * `POST /v1/webhook_endpoints` as on Stripe, and stores the signing secret the
 * answer carries beside it. `POST /v1/checkout/sessions` then answers a session
 * whose `url` is `GET /checkout/:id` here, which names what is sold and at what
 * price — every line item, less the fixed-amount coupon `POST /v1/coupons`
 * made for a discounted sale — and paying there signs
 * `checkout.session.completed`, delivers it to
 * every endpoint the secret key registered, and sends the reader on to the
 * session's success URL once the storefront has accepted it: an event carries
 * the `Stripe-Version` the session was created with, which is the version the
 * server's client verifies it against. The reader
 * therefore returns to an episode the purchase already opens.
 *
 * A subscription plan the console saves names a recurring Price, which publira
 * server reads with `GET /v1/prices/:id`; a spec makes one first with
 * `POST /v1/prices`, as an operator makes one in Stripe's dashboard. A
 * checkout of the plan is a session in `mode=subscription` that names the
 * Price: paying it starts an active subscription billed at that Price for one
 * of its periods, which `GET /v1/subscriptions/:id` answers and the delivered
 * event names. `GET /v1/checkout/sessions/:id` answers a session, and
 * `POST /v1/checkout/sessions/:id/expire` closes an open one, as the server
 * asks of a reader's earlier checkout. `POST /v1/billing_portal/sessions`
 * answers a page here that stands in for Stripe's customer portal, which links
 * back to the session's return URL.
 *
 * The console's refund reaches `POST /v1/refunds`, which refunds whatever is
 * left of a payment intent the secret key paid, and
 * `GET /v1/payment_intents/:id` answers one with its latest charge expanded.
 * The payment intents are those the checkout page paid, and those a spec
 * registered with `POST /payment-intents` for the payment ID a scenario seeds,
 * which Stripe's own API has no call for. No refund event is delivered.
 *
 * Everything is kept in memory and by secret key, as each Stripe account keeps
 * its own, so a suite that starts over on a stack that already ran it uses a
 * secret key of its own: the old one still answers its idempotency keys with
 * the sessions the suite paid before.
 */
import "temporal-polyfill/global";
import { createHmac, randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer, request as httpRequest } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

const port = Number(process.env.PUBLIRA_E2E_STRIPE_PORT);
if (!Number.isInteger(port) || port <= 0) {
  throw new Error("PUBLIRA_E2E_STRIPE_PORT must name the port to listen on");
}
const origin = `http://127.0.0.1:${port}`;

interface WebhookEndpoint {
  enabledEvents: string[];
  id: string;
  secret: string;
  url: string;
}

interface LineItem {
  amount: number;
  name: string;
}

interface CheckoutSession {
  /** What the reader pays: the line items, less the coupon's amount. */
  amount: number;
  /** The customer the server named; a subscription checkout makes one if not. */
  customer: string;
  /** The `Stripe-Version` the session was created with, which its events carry. */
  apiVersion: string;
  cancelURL: string;
  currency: string;
  /** What the coupon applied to the session takes off; 0 without one. */
  discount: number;
  id: string;
  lineItems: LineItem[];
  metadata: Record<string, string>;
  mode: "payment" | "subscription";
  paymentIntent: string;
  secretKey: string;
  status: "complete" | "expired" | "open";
  /** The subscription paying it started; empty until then. */
  subscription: string;
  /** What a subscription checkout puts on the subscription it starts. */
  subscriptionMetadata: Record<string, string>;
  /** The Price a subscription checkout bills; empty for a payment. */
  subscriptionPrice: string;
  successURL: string;
}

/** A payment intent paid in full, and what has been refunded of it since. */
interface PaymentIntent {
  amount: number;
  currency: string;
  id: string;
  refunded: number;
}

/** A recurring Price of one fixed amount, the only kind a plan can bill. */
interface Price {
  amount: number;
  currency: string;
  id: string;
  interval: string;
  intervalCount: number;
  /** The product it is a Price of, which heads its checkout page. */
  name: string;
}

/** A subscription a paid subscription checkout started. */
interface Subscription {
  customer: string;
  /** Unix seconds; the end of the period paid for. */
  currentPeriodEnd: number;
  id: string;
  metadata: Record<string, string>;
  price: string;
}

/** A session of the customer portal, which returns the reader to `returnURL`. */
interface BillingPortalSession {
  customer: string;
  id: string;
  returnURL: string;
}

/** The endpoints each secret key registered, one per URL. */
const endpoints = new Map<string, WebhookEndpoint[]>();
const sessions = new Map<string, CheckoutSession>();
/** The payment intents each secret key paid, by secret key and id. */
const paymentIntents = new Map<string, PaymentIntent>();
/** The Prices each secret key made, by secret key and id. */
const prices = new Map<string, Price>();
/** The fixed amount each coupon takes off, by secret key and coupon id. */
const coupons = new Map<string, number>();
/** The subscriptions each secret key's checkouts started, by secret key and id. */
const subscriptions = new Map<string, Subscription>();
const portals = new Map<string, BillingPortalSession>();
/**
 * What each secret key's idempotency key was first answered, which Stripe
 * answers again however the session has moved on since.
 */
const idempotent = new Map<string, unknown>();

const randomId = (prefix: string): string =>
  `${prefix}${randomBytes(12).toString("hex")}`;

const readBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
};

const answer = (
  response: ServerResponse,
  status: number,
  contentType: string,
  body: string
): void => {
  response.writeHead(status, { "content-type": contentType });
  response.end(body);
};

const answerJSON = (
  response: ServerResponse,
  status: number,
  body: unknown
): void => answer(response, status, "application/json", JSON.stringify(body));

/**
 * Stripe's error shape, which the client in publira server decodes. The code
 * is what the provider tells a refund already made from a refused one by.
 */
const answerError = (
  response: ServerResponse,
  status: number,
  message: string,
  code = "",
  type = "invalid_request_error"
): void =>
  answerJSON(response, status, {
    error: { ...(code ? { code } : {}), message, type },
  });

const secretKeyOf = (request: IncomingMessage): string =>
  (request.headers.authorization ?? "").replace(/^Bearer /u, "").trim();

/** The values of a form-encoded list such as `enabled_events[0]`. */
const listOf = (form: URLSearchParams, name: string): string[] =>
  [...form.entries()]
    .filter(([key]) => key === `${name}[]` || key.startsWith(`${name}[`))
    .map(([, value]) => value);

/** The entries of a form-encoded hash such as `metadata[tenant_id]`. */
const hashOf = (
  form: URLSearchParams,
  name: string
): Record<string, string> => {
  const entries: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    const field = new RegExp(`^${name}\\[(?<field>[^\\]]+)\\]$`, "u").exec(key)
      ?.groups?.field;
    if (field) {
      entries[field] = value;
    }
  }
  return entries;
};

const sessionObject = (session: CheckoutSession) => ({
  amount_subtotal: session.amount + session.discount,
  amount_total: session.amount,
  cancel_url: session.cancelURL,
  currency: session.currency,
  customer: session.customer || null,
  id: session.id,
  livemode: false,
  metadata: session.metadata,
  mode: session.mode,
  object: "checkout.session",
  payment_intent:
    session.mode === "payment" && session.status === "complete"
      ? session.paymentIntent
      : null,
  payment_status: session.status === "complete" ? "paid" : "unpaid",
  status: session.status,
  subscription: session.subscription || null,
  success_url: session.successURL,
  url: session.status === "open" ? `${origin}/checkout/${session.id}` : null,
});

const createWebhookEndpoint = async (
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> => {
  const form = new URLSearchParams(await readBody(request));
  const url = form.get("url") ?? "";
  if (!URL.canParse(url)) {
    answerError(response, 400, "Invalid URL: url must be an absolute URL.");
    return;
  }
  const secretKey = secretKeyOf(request);
  const endpoint: WebhookEndpoint = {
    enabledEvents: listOf(form, "enabled_events"),
    id: randomId("we_test_"),
    secret: randomId("whsec_"),
    url,
  };
  // A suite that starts over registers its URL again under a secret key it
  // stored again, so the newer endpoint replaces the one it left behind
  // rather than delivering a second time with a secret nobody holds.
  endpoints.set(secretKey, [
    ...(endpoints.get(secretKey) ?? []).filter((other) => other.url !== url),
    endpoint,
  ]);
  answerJSON(response, 200, {
    enabled_events: endpoint.enabledEvents,
    id: endpoint.id,
    livemode: false,
    object: "webhook_endpoint",
    secret: endpoint.secret,
    status: "enabled",
    url: endpoint.url,
  });
};

/**
 * The key a request's `Idempotency-Key` is answered under, which is the secret
 * key's own: empty when the request carries none.
 */
const replayKeyOf = (request: IncomingMessage, secretKey: string): string => {
  const idempotencyKey = request.headers["idempotency-key"];
  return typeof idempotencyKey === "string"
    ? `${secretKey}\n${idempotencyKey}`
    : "";
};

/**
 * A fixed-amount coupon, which is the only kind publira server makes: one for
 * each discounted checkout, applied to the session it is made for.
 */
const createCoupon = async (
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> => {
  const form = new URLSearchParams(await readBody(request));
  const secretKey = secretKeyOf(request);
  const replayKey = replayKeyOf(request, secretKey);
  if (idempotent.has(replayKey)) {
    answerJSON(response, 200, idempotent.get(replayKey));
    return;
  }

  const amountOff = Number(form.get("amount_off"));
  const currency = form.get("currency") ?? "";
  if (!Number.isInteger(amountOff) || amountOff <= 0 || !currency) {
    answerError(response, 400, "A coupon needs an amount_off and a currency.");
    return;
  }
  const id = randomId("coupon_test_");
  coupons.set(`${secretKey}\n${id}`, amountOff);
  const created = {
    amount_off: amountOff,
    currency,
    duration: form.get("duration") ?? "once",
    id,
    livemode: false,
    max_redemptions: Number(form.get("max_redemptions")) || null,
    name: form.get("name"),
    object: "coupon",
    percent_off: null,
    valid: true,
  };
  if (replayKey) {
    idempotent.set(replayKey, created);
  }
  answerJSON(response, 200, created);
};

/** Every `line_items[n]` of the request, in order, as one currency's prices. */
const lineItemsOf = (
  form: URLSearchParams
): { currency: string; items: LineItem[] } => {
  const items: LineItem[] = [];
  let currency = "";
  for (let index = 0; ; index += 1) {
    const item = `line_items[${index}][price_data]`;
    if (!form.has(`${item}[unit_amount]`)) {
      return { currency, items };
    }
    currency ||= form.get(`${item}[currency]`) ?? "";
    items.push({
      amount: Number(form.get(`${item}[unit_amount]`)),
      name: form.get(`${item}[product_data][name]`) ?? "",
    });
  }
};

/**
 * What a session sells: the Price a subscription checkout names, which the
 * account holds, or the line items a payment is built of. `null` is a
 * subscription checkout of a Price the account does not hold.
 */
const checkoutItemsOf = (
  form: URLSearchParams,
  secretKey: string
): {
  currency: string;
  items: LineItem[];
  mode: CheckoutSession["mode"];
  price?: Price;
} | null => {
  if (form.get("mode") !== "subscription") {
    return { ...lineItemsOf(form), mode: "payment" };
  }
  const price = prices.get(
    `${secretKey}\n${form.get("line_items[0][price]") ?? ""}`
  );
  return price
    ? {
        currency: price.currency,
        items: [{ amount: price.amount, name: price.name }],
        mode: "subscription",
        price,
      }
    : null;
};

const createCheckoutSession = async (
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> => {
  const form = new URLSearchParams(await readBody(request));
  const secretKey = secretKeyOf(request);
  const replayKey = replayKeyOf(request, secretKey);
  if (idempotent.has(replayKey)) {
    answerJSON(response, 200, idempotent.get(replayKey));
    return;
  }

  const sold = checkoutItemsOf(form, secretKey);
  if (!sold) {
    answerError(
      response,
      400,
      `No such price: '${form.get("line_items[0][price]") ?? ""}'`,
      "resource_missing"
    );
    return;
  }
  const { currency, items, mode, price: subscriptionPrice } = sold;
  const couponId = form.get("discounts[0][coupon]");
  const discount = couponId ? coupons.get(`${secretKey}\n${couponId}`) : 0;
  if (discount === undefined) {
    answerError(response, 400, `No such coupon: '${couponId}'`);
    return;
  }
  const subtotal = items.reduce((sum, { amount }) => sum + amount, 0);
  const session: CheckoutSession = {
    amount: subtotal - discount,
    apiVersion: String(request.headers["stripe-version"] ?? ""),
    cancelURL: form.get("cancel_url") ?? "",
    currency,
    customer: form.get("customer") ?? "",
    discount,
    id: randomId("cs_test_"),
    lineItems: items,
    metadata: hashOf(form, "metadata"),
    mode,
    paymentIntent: randomId("pi_test_"),
    secretKey,
    status: "open",
    subscription: "",
    subscriptionMetadata: hashOf(form, "subscription_data\\[metadata\\]"),
    subscriptionPrice: subscriptionPrice?.id ?? "",
    successURL: form.get("success_url") ?? "",
  };
  if (
    items.length === 0 ||
    items.some(({ amount }) => !Number.isInteger(amount) || amount <= 0) ||
    session.amount <= 0 ||
    !session.currency ||
    !URL.canParse(session.successURL)
  ) {
    answerError(
      response,
      400,
      "Line items with a price and a success URL are required."
    );
    return;
  }
  sessions.set(session.id, session);
  const created = sessionObject(session);
  if (replayKey) {
    idempotent.set(replayKey, created);
  }
  answerJSON(response, 200, created);
};

const priceObject = (price: Price) => ({
  active: true,
  billing_scheme: "per_unit",
  currency: price.currency,
  custom_unit_amount: null,
  id: price.id,
  livemode: false,
  object: "price",
  recurring: {
    interval: price.interval,
    interval_count: price.intervalCount,
    usage_type: "licensed",
  },
  type: "recurring",
  unit_amount: price.amount,
});

/**
 * A recurring Price billed `recurring[interval_count]` (1 when omitted)
 * `recurring[interval]`s, at `unit_amount` in `currency`, of the product
 * `product_data[name]` names. A Price that bills once is not made here: no
 * plan can name one.
 */
const createPrice = async (
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> => {
  const form = new URLSearchParams(await readBody(request));
  const amount = Number(form.get("unit_amount"));
  const currency = (form.get("currency") ?? "").toLowerCase();
  const interval = form.get("recurring[interval]") ?? "";
  const intervalCount = Number(form.get("recurring[interval_count]") ?? "1");
  if (
    !Number.isInteger(amount) ||
    amount < 0 ||
    !currency ||
    !["day", "week", "month", "year"].includes(interval) ||
    !Number.isInteger(intervalCount) ||
    intervalCount < 1
  ) {
    answerError(
      response,
      400,
      "A Price needs a unit_amount, a currency, and a recurring interval."
    );
    return;
  }
  const price: Price = {
    amount,
    currency,
    id: randomId("price_test_"),
    interval,
    intervalCount,
    name: form.get("product_data[name]") ?? "Subscription",
  };
  prices.set(`${secretKeyOf(request)}\n${price.id}`, price);
  answerJSON(response, 200, priceObject(price));
};

const getPrice = (
  id: string,
  request: IncomingMessage,
  response: ServerResponse
): void => {
  const price = prices.get(`${secretKeyOf(request)}\n${id}`);
  if (!price) {
    answerError(response, 404, `No such price: '${id}'`, "resource_missing");
    return;
  }
  answerJSON(response, 200, priceObject(price));
};

/** A payment intent with its latest charge expanded, as the provider asks. */
const paymentIntentObject = (intent: PaymentIntent) => ({
  amount: intent.amount,
  currency: intent.currency,
  id: intent.id,
  latest_charge: {
    amount: intent.amount,
    amount_refunded: intent.refunded,
    currency: intent.currency,
    id: `ch_${intent.id}`,
    object: "charge",
    payment_intent: intent.id,
    refunded: intent.refunded >= intent.amount,
  },
  livemode: false,
  object: "payment_intent",
  status: "succeeded",
});

/**
 * Make `id` a payment intent the secret key was paid `amount` on, with nothing
 * refunded of it, as the payment a scenario seeds for a purchase stands for.
 * It replaces whatever the secret key held under the id.
 */
const registerPaymentIntent = async (
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> => {
  const { amount, currency, id } = JSON.parse(await readBody(request)) as {
    amount?: unknown;
    currency?: unknown;
    id?: unknown;
  };
  if (
    typeof id !== "string" ||
    !id ||
    typeof amount !== "number" ||
    !Number.isInteger(amount) ||
    amount <= 0 ||
    typeof currency !== "string" ||
    !currency
  ) {
    answerError(
      response,
      400,
      "A payment intent needs an id, an amount, and a currency."
    );
    return;
  }
  const intent: PaymentIntent = {
    amount,
    currency: currency.toLowerCase(),
    id,
    refunded: 0,
  };
  paymentIntents.set(`${secretKeyOf(request)}\n${id}`, intent);
  answerJSON(response, 200, paymentIntentObject(intent));
};

const getPaymentIntent = (
  id: string,
  request: IncomingMessage,
  response: ServerResponse
): void => {
  const intent = paymentIntents.get(`${secretKeyOf(request)}\n${id}`);
  if (!intent) {
    answerError(
      response,
      404,
      `No such payment_intent: '${id}'`,
      "resource_missing"
    );
    return;
  }
  answerJSON(response, 200, paymentIntentObject(intent));
};

/**
 * Refund what is left of a payment intent, or the `amount` asked for. A
 * request repeating an idempotency key is answered with the refund the key
 * first made and refunds nothing more, and one on a payment intent refunded
 * in full is refused with the code the provider reads as "nothing left".
 */
const createRefund = async (
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> => {
  const form = new URLSearchParams(await readBody(request));
  const secretKey = secretKeyOf(request);
  const id = form.get("payment_intent") ?? "";
  const replayKey = replayKeyOf(request, secretKey);
  if (idempotent.has(replayKey)) {
    const replayed = idempotent.get(replayKey) as { payment_intent?: string };
    if (replayed.payment_intent !== id) {
      answerError(
        response,
        400,
        "Keys for idempotent requests can only be used with the same parameters they were first used with.",
        "",
        "idempotency_error"
      );
      return;
    }
    answerJSON(response, 200, replayed);
    return;
  }

  const intent = paymentIntents.get(`${secretKey}\n${id}`);
  if (!intent) {
    answerError(
      response,
      404,
      `No such payment_intent: '${id}'`,
      "resource_missing"
    );
    return;
  }
  const left = intent.amount - intent.refunded;
  if (left <= 0) {
    answerError(
      response,
      400,
      "Charge has already been refunded.",
      "charge_already_refunded"
    );
    return;
  }
  const amount = form.has("amount") ? Number(form.get("amount")) : left;
  if (!Number.isInteger(amount) || amount <= 0 || amount > left) {
    answerError(
      response,
      400,
      "Refund amount is greater than unrefunded amount on charge.",
      "amount_too_large"
    );
    return;
  }
  intent.refunded += amount;
  const created = {
    amount,
    charge: `ch_${intent.id}`,
    currency: intent.currency,
    id: randomId("re_test_"),
    object: "refund",
    payment_intent: intent.id,
    status: "succeeded",
  };
  if (replayKey) {
    idempotent.set(replayKey, created);
  }
  answerJSON(response, 200, created);
};

const getCheckoutSession = (
  id: string,
  request: IncomingMessage,
  response: ServerResponse
): void => {
  const session = sessions.get(id);
  if (!session || session.secretKey !== secretKeyOf(request)) {
    answerError(
      response,
      404,
      `No such checkout.session: '${id}'`,
      "resource_missing"
    );
    return;
  }
  answerJSON(response, 200, sessionObject(session));
};

/** Close an open session, which Stripe refuses for one that is not open. */
const expireCheckoutSession = (
  id: string,
  request: IncomingMessage,
  response: ServerResponse
): void => {
  const session = sessions.get(id);
  if (!session || session.secretKey !== secretKeyOf(request)) {
    answerError(
      response,
      404,
      `No such checkout.session: '${id}'`,
      "resource_missing"
    );
    return;
  }
  if (session.status !== "open") {
    answerError(
      response,
      400,
      'Only Checkout Sessions with a status in ["open"] can be expired.'
    );
    return;
  }
  session.status = "expired";
  answerJSON(response, 200, sessionObject(session));
};

/** A subscription in the shape Stripe answers it: active, on its one Price. */
const subscriptionObject = (subscription: Subscription) => ({
  cancel_at_period_end: false,
  customer: subscription.customer,
  id: subscription.id,
  items: {
    data: [
      {
        current_period_end: subscription.currentPeriodEnd,
        id: `si_${subscription.id}`,
        object: "subscription_item",
        price: { id: subscription.price, object: "price" },
      },
    ],
    object: "list",
  },
  livemode: false,
  metadata: subscription.metadata,
  object: "subscription",
  status: "active",
});

const getSubscription = (
  id: string,
  request: IncomingMessage,
  response: ServerResponse
): void => {
  const subscription = subscriptions.get(`${secretKeyOf(request)}\n${id}`);
  if (!subscription) {
    answerError(
      response,
      404,
      `No such subscription: '${id}'`,
      "resource_missing"
    );
    return;
  }
  answerJSON(response, 200, subscriptionObject(subscription));
};

const createBillingPortalSession = async (
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> => {
  const form = new URLSearchParams(await readBody(request));
  const portal: BillingPortalSession = {
    customer: form.get("customer") ?? "",
    id: randomId("bps_test_"),
    returnURL: form.get("return_url") ?? "",
  };
  if (!portal.customer || !URL.canParse(portal.returnURL)) {
    answerError(response, 400, "A customer and a return URL are required.");
    return;
  }
  portals.set(portal.id, portal);
  answerJSON(response, 200, {
    customer: portal.customer,
    id: portal.id,
    livemode: false,
    object: "billing_portal.session",
    return_url: portal.returnURL,
    url: `${origin}/billing/${portal.id}`,
  });
};

/** The end of one period of `price` from now, in Unix seconds. */
const periodEndOf = (price: Price | undefined): number => {
  const unit = price?.interval ?? "month";
  const count = price?.intervalCount ?? 1;
  return Math.floor(
    Temporal.Now.zonedDateTimeISO("UTC").add({ [`${unit}s`]: count })
      .epochMilliseconds / 1000
  );
};

/** What Stripe puts in `Stripe-Signature`: a timestamp and its HMAC. */
const signature = (payload: string, secret: string): string => {
  const timestamp = Math.floor(Temporal.Now.instant().epochMilliseconds / 1000);
  const digest = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  return `t=${timestamp},v1=${digest}`;
};

/**
 * Post an event to an endpoint and answer the storefront's status and body.
 * A `localhost` name is reached on loopback, as RFC 6761 has every such name
 * resolve, which is how Chromium reaches the tenant hosts of the stack; the
 * `Host` header keeps the name, which is what the edge routes by.
 */
const deliver = async (
  endpoint: WebhookEndpoint,
  payload: string
): Promise<{ body: string; status: number }> => {
  const target = new URL(endpoint.url);
  if (target.protocol !== "http:") {
    throw new Error(`cannot deliver to ${endpoint.url}: only http is served`);
  }
  const { hostname } = target;
  const loopback = hostname === "localhost" || hostname.endsWith(".localhost");
  const outgoing = httpRequest({
    headers: {
      "content-length": Buffer.byteLength(payload),
      "content-type": "application/json; charset=utf-8",
      host: target.host,
      "stripe-signature": signature(payload, endpoint.secret),
    },
    host: loopback ? "127.0.0.1" : hostname,
    method: "POST",
    path: `${target.pathname}${target.search}`,
    port: target.port || 80,
  });
  outgoing.end(payload);
  const [incoming] = (await once(outgoing, "response")) as [IncomingMessage];
  return { body: await readBody(incoming), status: incoming.statusCode ?? 0 };
};

const escapeHTML = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** An amount in the currency's minor unit, as the reader would read it. */
const formatAmount = (amount: number, currency: string): string => {
  const format = new Intl.NumberFormat("en", {
    currency: currency.toUpperCase(),
    style: "currency",
  });
  const digits = format.resolvedOptions().maximumFractionDigits ?? 0;
  return format.format(amount / 10 ** digits);
};

const page = (title: string, body: string): string => `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>${escapeHTML(title)}</title>
<main>
${body}
</main>
</html>
`;

/**
 * What the session sells: the one item by its name, as Stripe heads its page
 * with it, or several under a count, each with its own price, and the coupon's
 * amount below them.
 */
const itemsHTML = (session: CheckoutSession): string => {
  const [first] = session.lineItems;
  if (session.lineItems.length === 1 && first) {
    return `<h1>${escapeHTML(first.name)}</h1>`;
  }
  const items = session.lineItems
    .map(
      ({ amount, name }) =>
        `<li>${escapeHTML(name)} ${escapeHTML(formatAmount(amount, session.currency))}</li>`
    )
    .join("\n");
  const discount =
    session.discount > 0
      ? `\n<p>Discount ${escapeHTML(formatAmount(-session.discount, session.currency))}</p>`
      : "";
  return `<h1>${session.lineItems.length} items</h1>
<ul>
${items}
</ul>${discount}`;
};

const checkoutPage = (session: CheckoutSession): string =>
  page(
    "Checkout",
    `${itemsHTML(session)}
<p>${escapeHTML(formatAmount(session.amount, session.currency))}</p>
<form method="post" action="/checkout/${escapeHTML(session.id)}">
  <button type="submit">Pay</button>
</form>
<a href="${escapeHTML(session.cancelURL)}">Cancel</a>`
  );

/**
 * Pay for the session: complete it, deliver `checkout.session.completed` to
 * the secret key's endpoints, and send the reader to the success URL with the
 * session id in place of `{CHECKOUT_SESSION_ID}`. A delivery the storefront
 * refuses stops here with what it answered, so a spec fails on the page that
 * says why rather than on an episode that never opened.
 */
const pay = async (
  session: CheckoutSession,
  response: ServerResponse
): Promise<void> => {
  const type = "checkout.session.completed";
  // A subscription checkout starts its subscription before the event that
  // names it is delivered, as the server reads it back on receiving it.
  const paid = { ...session, status: "complete" as const };
  if (session.mode === "subscription") {
    paid.customer ||= randomId("cus_test_");
    paid.subscription = randomId("sub_test_");
    subscriptions.set(`${session.secretKey}\n${paid.subscription}`, {
      currentPeriodEnd: periodEndOf(
        prices.get(`${session.secretKey}\n${session.subscriptionPrice}`)
      ),
      customer: paid.customer,
      id: paid.subscription,
      metadata: session.subscriptionMetadata,
      price: session.subscriptionPrice,
    });
  }
  const payload = JSON.stringify({
    api_version: session.apiVersion,
    created: Math.floor(Temporal.Now.instant().epochMilliseconds / 1000),
    data: { object: sessionObject(paid) },
    id: randomId("evt_test_"),
    livemode: false,
    object: "event",
    pending_webhooks: 1,
    type,
  });
  const subscribed = (endpoints.get(session.secretKey) ?? []).filter(
    ({ enabledEvents }) =>
      enabledEvents.includes("*") || enabledEvents.includes(type)
  );
  const deliveries = await Promise.all(
    subscribed.map(async (endpoint) => ({
      ...(await deliver(endpoint, payload)),
      url: endpoint.url,
    }))
  );
  for (const delivered of deliveries) {
    if (delivered.status < 200 || delivered.status >= 300) {
      answer(
        response,
        502,
        "text/html; charset=utf-8",
        page(
          "Webhook refused",
          `<h1>Webhook refused</h1>
<p>${escapeHTML(delivered.url)} answered ${delivered.status}.</p>
<pre>${escapeHTML(delivered.body)}</pre>`
        )
      );
      return;
    }
  }
  Object.assign(session, paid);
  if (session.mode === "payment") {
    paymentIntents.set(`${session.secretKey}\n${session.paymentIntent}`, {
      amount: session.amount,
      currency: session.currency,
      id: session.paymentIntent,
      refunded: 0,
    });
  }
  response.writeHead(303, {
    location: session.successURL.replaceAll(
      "{CHECKOUT_SESSION_ID}",
      session.id
    ),
  });
  response.end();
};

/** The page a portal session's `url` names, which leads back to the site. */
const billingPortalPage = (portal: BillingPortalSession): string =>
  page(
    "Billing",
    `<h1>Billing</h1>
<a href="${escapeHTML(portal.returnURL)}">Return to the site</a>`
  );

/** The checkout page a session's `url` names: shown with GET, paid with POST. */
const handleCheckout = async (
  id: string,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> => {
  const session = sessions.get(id);
  if (!session) {
    answer(response, 404, "text/plain", "no such checkout session");
    return;
  }
  if (session.status !== "open") {
    answer(response, 410, "text/plain", "the checkout session is complete");
    return;
  }
  if (request.method === "GET") {
    answer(response, 200, "text/html; charset=utf-8", checkoutPage(session));
    return;
  }
  if (request.method === "POST") {
    await pay(session, response);
    return;
  }
  answer(response, 405, "text/plain", "method not allowed");
};

type Handler = (
  request: IncomingMessage,
  response: ServerResponse
) => Promise<void>;

/**
 * The calls that answer one path, by method and path. Each is made under a
 * secret key: Stripe's own under `/v1/`, and the registration of a payment
 * intent, which a spec makes on behalf of an account as Stripe's dashboard
 * would.
 */
const apiRoutes = new Map<string, Handler>([
  ["POST /payment-intents", registerPaymentIntent],
  ["POST /v1/billing_portal/sessions", createBillingPortalSession],
  ["POST /v1/checkout/sessions", createCheckoutSession],
  ["POST /v1/coupons", createCoupon],
  ["POST /v1/prices", createPrice],
  ["POST /v1/refunds", createRefund],
  ["POST /v1/webhook_endpoints", createWebhookEndpoint],
]);

/** The page a portal session's `url` names, shown with GET. */
const showBillingPortal = (
  id: string,
  _request: IncomingMessage,
  response: ServerResponse
): void => {
  const portal = portals.get(id);
  if (!portal) {
    answer(response, 404, "text/plain", "no such billing portal session");
    return;
  }
  answer(response, 200, "text/html; charset=utf-8", billingPortalPage(portal));
};

/**
 * The calls that answer a path naming one record, by method and the pattern
 * that captures its id.
 */
const recordRoutes: [
  string,
  RegExp,
  (id: string, request: IncomingMessage, response: ServerResponse) => void,
][] = [
  ["GET", /^\/v1\/payment_intents\/(?<id>[^/]+)$/u, getPaymentIntent],
  ["GET", /^\/v1\/prices\/(?<id>[^/]+)$/u, getPrice],
  ["GET", /^\/v1\/checkout\/sessions\/(?<id>[^/]+)$/u, getCheckoutSession],
  [
    "POST",
    /^\/v1\/checkout\/sessions\/(?<id>[^/]+)\/expire$/u,
    expireCheckoutSession,
  ],
  ["GET", /^\/v1\/subscriptions\/(?<id>[^/]+)$/u, getSubscription],
  ["GET", /^\/billing\/(?<id>[^/]+)$/u, showBillingPortal],
];

const handle = async (
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> => {
  const { pathname } = new URL(request.url ?? "/", origin);
  if (request.method === "GET" && pathname === "/readyz") {
    answerJSON(response, 200, { status: "ok" });
    return;
  }
  const route = apiRoutes.get(`${request.method} ${pathname}`);
  if ((route || pathname.startsWith("/v1/")) && !secretKeyOf(request)) {
    answerError(response, 401, "You did not provide an API key.");
    return;
  }
  if (route) {
    await route(request, response);
    return;
  }
  for (const [method, pattern, answerRecord] of recordRoutes) {
    const id = pattern.exec(pathname)?.groups?.id;
    if (id && request.method === method) {
      answerRecord(id, request, response);
      return;
    }
  }
  const checkout = /^\/checkout\/(?<id>[^/]+)$/u.exec(pathname)?.groups?.id;
  if (checkout) {
    await handleCheckout(checkout, request, response);
    return;
  }
  answer(response, 404, "text/plain", "not found");
};

createServer(async (request, response) => {
  try {
    await handle(request, response);
  } catch (error) {
    answer(response, 500, "text/plain", String(error));
  }
}).listen(port, "127.0.0.1");
