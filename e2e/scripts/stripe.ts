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
 * price, and paying there signs `checkout.session.completed`, delivers it to
 * every endpoint the secret key registered, and sends the reader on to the
 * session's success URL once the storefront has accepted it: an event carries
 * the `Stripe-Version` the session was created with, which is the version the
 * server's client verifies it against. The reader
 * therefore returns to an episode the purchase already opens.
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

interface CheckoutSession {
  amount: number;
  /** The `Stripe-Version` the session was created with, which its events carry. */
  apiVersion: string;
  cancelURL: string;
  currency: string;
  id: string;
  metadata: Record<string, string>;
  name: string;
  paymentIntent: string;
  secretKey: string;
  status: "complete" | "open";
  successURL: string;
}

/** The endpoints each secret key registered, one per URL. */
const endpoints = new Map<string, WebhookEndpoint[]>();
const sessions = new Map<string, CheckoutSession>();
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

/** Stripe's error shape, which the client in publira server decodes. */
const answerError = (
  response: ServerResponse,
  status: number,
  message: string
): void =>
  answerJSON(response, status, {
    error: { message, type: "invalid_request_error" },
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
  amount_subtotal: session.amount,
  amount_total: session.amount,
  cancel_url: session.cancelURL,
  currency: session.currency,
  id: session.id,
  livemode: false,
  metadata: session.metadata,
  mode: "payment",
  object: "checkout.session",
  payment_intent: session.status === "complete" ? session.paymentIntent : null,
  payment_status: session.status === "complete" ? "paid" : "unpaid",
  status: session.status,
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

const createCheckoutSession = async (
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> => {
  const form = new URLSearchParams(await readBody(request));
  const secretKey = secretKeyOf(request);
  const idempotencyKey = request.headers["idempotency-key"];
  const replayKey =
    typeof idempotencyKey === "string" ? `${secretKey}\n${idempotencyKey}` : "";
  if (idempotent.has(replayKey)) {
    answerJSON(response, 200, idempotent.get(replayKey));
    return;
  }

  const item = "line_items[0][price_data]";
  const session: CheckoutSession = {
    amount: Number(form.get(`${item}[unit_amount]`)),
    apiVersion: String(request.headers["stripe-version"] ?? ""),
    cancelURL: form.get("cancel_url") ?? "",
    currency: form.get(`${item}[currency]`) ?? "",
    id: randomId("cs_test_"),
    metadata: hashOf(form, "metadata"),
    name: form.get(`${item}[product_data][name]`) ?? "",
    paymentIntent: randomId("pi_test_"),
    secretKey,
    status: "open",
    successURL: form.get("success_url") ?? "",
  };
  if (
    !Number.isInteger(session.amount) ||
    session.amount <= 0 ||
    !session.currency ||
    !URL.canParse(session.successURL)
  ) {
    answerError(
      response,
      400,
      "A line item with a price and a success URL is required."
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

const checkoutPage = (session: CheckoutSession): string =>
  page(
    "Checkout",
    `<h1>${escapeHTML(session.name)}</h1>
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
  const payload = JSON.stringify({
    api_version: session.apiVersion,
    created: Math.floor(Temporal.Now.instant().epochMilliseconds / 1000),
    data: { object: sessionObject({ ...session, status: "complete" }) },
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
  session.status = "complete";
  response.writeHead(303, {
    location: session.successURL.replaceAll(
      "{CHECKOUT_SESSION_ID}",
      session.id
    ),
  });
  response.end();
};

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

const handle = async (
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> => {
  const { pathname } = new URL(request.url ?? "/", origin);
  if (request.method === "GET" && pathname === "/readyz") {
    answerJSON(response, 200, { status: "ok" });
    return;
  }
  if (pathname.startsWith("/v1/") && !secretKeyOf(request)) {
    answerError(response, 401, "You did not provide an API key.");
    return;
  }
  if (request.method === "POST" && pathname === "/v1/webhook_endpoints") {
    await createWebhookEndpoint(request, response);
    return;
  }
  if (request.method === "POST" && pathname === "/v1/checkout/sessions") {
    await createCheckoutSession(request, response);
    return;
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
