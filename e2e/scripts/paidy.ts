/**
 * Stands in for Paidy during an E2E run: the API calls publira server makes to
 * complete a checkout, read a payment, and refund it, and a fake of Paidy
 * Checkout, the script a storefront page loads from `https://apps.paidy.com/`.
 *
 * publira server reaches the API through `PUBLIRA_PAIDY_API_URL`, which
 * `lib.sh` points here. `GET /payments/:id` answers a payment,
 * `POST /payments/:id/captures` captures one Paidy Checkout authorized, and
 * `POST /payments/:id/refunds` refunds what is left of a captured payment, or
 * the amount it names, keeping the metadata the request carries beside the
 * refund. Every call names the version of the API publira server is written
 * against in `Paidy-Version`, and a secret key in `Authorization`.
 *
 * A spec never opens `https://apps.paidy.com/`: it routes the page's request
 * for the script to `GET /paidy.js` here. The fake defines `Paidy.configure`,
 * whose `launch` shows a dialog naming the amount the payload charges and the
 * order it names. **Authorize** asks `POST /checkout/authorize` here for a
 * payment of the payload, authorized and not captured, and hands the page's
 * `closed` callback its id with the `authorized` status; **Close** hands it
 * the `closed` status alone, as Paidy Checkout does for a reader who closes
 * it before paying.
 *
 * Paidy keeps a public key and a secret key for each mode of an account, and
 * the stand-in reads the account from a key with its `pk_` or `sk_` taken
 * off, so `pk_test_abc` and `sk_test_abc` name the same account. A payment
 * made under a key that starts `pk_test_` is a test payment. Everything is
 * kept in memory, and the stand-in delivers no notification: the page hands
 * the payment to publira server itself.
 */
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

const port = Number(process.env.PUBLIRA_E2E_PAIDY_PORT);

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("PUBLIRA_E2E_PAIDY_PORT must name the port to listen on");
}

const origin = `http://127.0.0.1:${port}`;

/** The version of the API publira server is written against. */
const API_VERSION = "2018-04-10";

interface Capture {
  amount: number;
  created_at: string;
  id: string;
}

interface Refund {
  amount: number;
  capture_id: string;
  created_at: string;
  id: string;
  metadata: Record<string, string>;
}

interface Payment {
  amount: number;
  captures: Capture[];
  created_at: string;
  currency: string;
  id: string;
  order: { order_ref: string };
  refunds: Refund[];
  status: "authorized" | "closed";
  test: boolean;
}

/** What the fake script asks `POST /checkout/authorize` for. */
interface AuthorizeRequest {
  api_key: string;
  payload: {
    amount: number;
    currency: string;
    order: { order_ref: string };
  };
}

/** What publira server asks `POST /payments/:id/refunds` for. */
interface RefundRequest {
  amount?: number;
  capture_id: string;
  metadata?: Record<string, string>;
}

const isAuthorizeRequest = (body: unknown): body is AuthorizeRequest =>
  typeof body === "object" &&
  body !== null &&
  "api_key" in body &&
  typeof body.api_key === "string" &&
  body.api_key.startsWith("pk_") &&
  "payload" in body &&
  typeof body.payload === "object" &&
  body.payload !== null &&
  "amount" in body.payload &&
  typeof body.payload.amount === "number" &&
  "currency" in body.payload &&
  typeof body.payload.currency === "string" &&
  "order" in body.payload &&
  typeof body.payload.order === "object" &&
  body.payload.order !== null &&
  "order_ref" in body.payload.order &&
  typeof body.payload.order.order_ref === "string";

const isString = (value: unknown): value is string => typeof value === "string";

const isMetadata = (value: unknown): value is Record<string, string> =>
  typeof value === "object" &&
  value !== null &&
  Object.values(value).every(isString);

const isRefundRequest = (body: unknown): body is RefundRequest =>
  typeof body === "object" &&
  body !== null &&
  "capture_id" in body &&
  typeof body.capture_id === "string" &&
  (!("amount" in body) || typeof body.amount === "number") &&
  (!("metadata" in body) || isMetadata(body.metadata));

const isObject = (body: unknown): body is object =>
  typeof body === "object" && body !== null && !Array.isArray(body);

/** Payments by account, then by id. */
const accounts = new Map<string, Map<string, Payment>>();

const accountOf = (key: string): Map<string, Payment> => {
  const account = key.replace(/^[ps]k_/u, "");
  let payments = accounts.get(account);

  if (!payments) {
    payments = new Map();
    accounts.set(account, payments);
  }

  return payments;
};

const randomId = (prefix: string): string =>
  `${prefix}${randomBytes(8).toString("hex")}`;

/** Now, as Paidy writes an instant. */
const now = (): string => Temporal.Now.instant().toString();

const readBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf-8");
};

/** The body of a request when it is a JSON object, and `null` otherwise. */
const readObject = async (request: IncomingMessage): Promise<object | null> => {
  try {
    const body: unknown = JSON.parse(await readBody(request));

    return isObject(body) ? body : null;
  } catch {
    return null;
  }
};

/** The page's origin may call `POST /checkout/authorize` from the fake script. */
const CORS_HEADERS = {
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "POST",
  "access-control-allow-origin": "*",
};

const answer = (
  response: ServerResponse,
  status: number,
  contentType: string,
  body: string
): void => {
  response.writeHead(status, { "content-type": contentType, ...CORS_HEADERS });
  response.end(body);
};

const answerJSON = <Body>(
  response: ServerResponse,
  status: number,
  body: Body
): void => answer(response, status, "application/json", JSON.stringify(body));

/** Paidy's error shape. */
const answerError = (
  response: ServerResponse,
  status: number,
  code: string,
  title: string
): void =>
  answerJSON(response, status, {
    code,
    title,
    description: title,
    reference: "paidy-stand-in",
    status: String(status),
  });

/**
 * The fake of Paidy Checkout. It asks this stand-in for the payment, which a
 * page on the storefront's origin may do since the stand-in allows any.
 */
const fakeScript = `(() => {
  const stand = ${JSON.stringify(origin)};
  const configure = (config) => ({
    launch: (payload) => {
      const dialog = document.createElement("dialog");
      dialog.setAttribute("aria-label", "Paidy Checkout");
      const heading = document.createElement("h2");
      heading.textContent = "Paidy Checkout";
      const amount = document.createElement("p");
      amount.textContent = "Amount: " + payload.amount + " " + payload.currency;
      const buyer = document.createElement("p");
      buyer.textContent = "Buyer: " + ((payload.buyer && payload.buyer.name1) || "");
      const authorize = document.createElement("button");
      authorize.type = "button";
      authorize.textContent = "Authorize";
      const close = document.createElement("button");
      close.type = "button";
      close.textContent = "Close";
      dialog.append(heading, amount, buyer, authorize, close);
      document.body.append(dialog);
      dialog.showModal();
      const finish = (data) => {
        dialog.close();
        dialog.remove();
        config.closed(data);
      };
      authorize.addEventListener("click", async () => {
        const response = await fetch(stand + "/checkout/authorize", {
          body: JSON.stringify({ api_key: config.api_key, payload }),
          headers: { "content-type": "application/json" },
          method: "POST",
        });
        const payment = await response.json();
        finish({
          amount: payment.amount,
          created_at: payment.created_at,
          currency: payment.currency,
          id: payment.id,
          status: "authorized",
        });
      });
      close.addEventListener("click", () => finish({ status: "closed" }));
    },
  });
  window.Paidy = { configure };
})();
`;

/** A payment as the API answers it. */
const paymentAnswer = (payment: Payment) => ({
  ...payment,
  expires_at: Temporal.Instant.from(payment.created_at)
    .add({ hours: 30 * 24 })
    .toString(),
  metadata: {},
  tier: "classic",
});

/** Make the payment the fake script's payload asks for, authorized. */
const authorize = async (
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> => {
  const body = await readObject(request);

  if (!isAuthorizeRequest(body)) {
    answerError(
      response,
      401,
      "authentication.failed",
      "Authentication failed"
    );

    return;
  }

  const payment: Payment = {
    amount: body.payload.amount,
    captures: [],
    created_at: now(),
    currency: body.payload.currency,
    id: randomId("pay_"),
    order: { order_ref: body.payload.order.order_ref },
    refunds: [],
    status: "authorized",
    test: body.api_key.startsWith("pk_test_"),
  };

  accountOf(body.api_key).set(payment.id, payment);
  answerJSON(response, 200, paymentAnswer(payment));
};

/** Capture a payment Paidy Checkout authorized, in full. */
const capture = (response: ServerResponse, payment: Payment): void => {
  if (payment.status !== "authorized") {
    answerError(response, 403, "service.forbidden", "Not capturable");

    return;
  }

  payment.status = "closed";
  payment.captures = [
    { amount: payment.amount, created_at: now(), id: randomId("cap_") },
  ];
  answerJSON(response, 200, paymentAnswer(payment));
};

/** Refund the amount the request names of a payment's capture, or the rest. */
const refund = (
  response: ServerResponse,
  payment: Payment,
  body: RefundRequest
): void => {
  const [captured] = payment.captures;

  if (!captured || body.capture_id !== captured.id) {
    answerError(response, 400, "payment.refund.captureId", "Invalid capture");

    return;
  }

  const remaining =
    captured.amount -
    payment.refunds.reduce((total, made) => total + made.amount, 0);

  const amount = body.amount ?? remaining;

  if (remaining <= 0) {
    answerError(response, 403, "service.forbidden", "Refunded in full");

    return;
  }

  if (amount <= 0 || amount > remaining) {
    answerError(response, 400, "payment.refund.amount", "Invalid amount");

    return;
  }

  payment.refunds.push({
    amount,
    capture_id: captured.id,
    created_at: now(),
    id: randomId("ref_"),
    metadata: body.metadata ?? {},
  });
  answerJSON(response, 200, paymentAnswer(payment));
};

/** The account the secret key a call of the API is made under names. */
const accountOfRequest = (
  request: IncomingMessage,
  response: ServerResponse
): Map<string, Payment> | null => {
  if (request.headers["paidy-version"] !== API_VERSION) {
    answerError(response, 400, "version.unknown", "Unknown API version");

    return null;
  }

  const secretKey = /^Bearer (?<key>sk_\S+)$/u.exec(
    request.headers.authorization ?? ""
  )?.groups?.key;

  if (!secretKey) {
    answerError(
      response,
      401,
      "authentication.failed",
      "Authentication failed"
    );

    return null;
  }

  return accountOf(secretKey);
};

/** Answer one call of the API, on the account its secret key names. */
const handleAPI = async (
  request: IncomingMessage,
  response: ServerResponse,
  id: string,
  action: string | undefined
): Promise<void> => {
  const payment = accountOfRequest(request, response)?.get(id);

  if (response.headersSent) {
    return;
  }

  if (!payment) {
    answerError(response, 404, "404", "Not found");

    return;
  }

  if (request.method === "GET" && action === undefined) {
    answerJSON(response, 200, paymentAnswer(payment));

    return;
  }

  const body = await readObject(request);

  if (request.method === "POST" && action === "captures" && body !== null) {
    capture(response, payment);

    return;
  }

  if (
    request.method === "POST" &&
    action === "refunds" &&
    isRefundRequest(body)
  ) {
    refund(response, payment, body);

    return;
  }

  answerError(
    response,
    400,
    "request_content.malformed",
    "Malformed request content"
  );
};

const handle = async (
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> => {
  const { pathname } = new URL(request.url ?? "/", origin);

  if (request.method === "OPTIONS") {
    response.writeHead(204, CORS_HEADERS);
    response.end();

    return;
  }

  if (request.method === "GET" && pathname === "/readyz") {
    answerJSON(response, 200, { status: "ok" });

    return;
  }

  if (request.method === "GET" && pathname === "/paidy.js") {
    answer(response, 200, "text/javascript", fakeScript);

    return;
  }

  if (request.method === "POST" && pathname === "/checkout/authorize") {
    await authorize(request, response);

    return;
  }

  const route =
    /^\/payments\/(?<id>[^/]+)(?:\/(?<action>captures|refunds))?$/u.exec(
      pathname
    )?.groups;

  if (route?.id) {
    await handleAPI(request, response, route.id, route.action);

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
