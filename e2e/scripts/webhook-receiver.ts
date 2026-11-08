/**
 * Stands in for the system a tenant runs behind a webhook endpoint during an
 * E2E run, so a delivery the worker sends arrives somewhere a spec can see.
 *
 * The worker delivers to `POST /<name>` on the https port, whose certificate
 * `webhook-receiver.sh` makes and `worker.sh` hands the worker to trust. Each
 * delivery is recorded under its name with whether its `X-Publira-Signature`
 * verified against the secret set for that name, and answered `401` when it
 * did not, as a receiver following the documentation refuses it.
 *
 * A spec reaches the plain HTTP port, because nothing in the test process
 * trusts that certificate: `PUT /__e2e/secrets/<name>` sets the secret, and
 * `GET /__e2e/deliveries/<name>` answers what was recorded, oldest first.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";

/** How old a signature may be, the five minutes the documentation advises. */
const TOLERANCE_SECONDS = 300;

const portFrom = (name: string): number => {
  const port = Number(process.env[name]);

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`${name} must name the port to listen on`);
  }

  return port;
};

const fileFrom = (name: string): string => {
  const path = process.env[name];

  if (!path) {
    throw new Error(`${name} must name the file to read`);
  }

  return readFileSync(path, "utf-8");
};

const port = portFrom("PUBLIRA_E2E_WEBHOOK_RECEIVER_PORT");
const httpsPort = portFrom("PUBLIRA_E2E_WEBHOOK_RECEIVER_HTTPS_PORT");
const cert = fileFrom("PUBLIRA_E2E_WEBHOOK_RECEIVER_CERT_FILE");
const key = fileFrom("PUBLIRA_E2E_WEBHOOK_RECEIVER_KEY_FILE");

interface RecordedDelivery {
  /** The body, as JSON. */
  body: unknown;
  /** `X-Publira-Delivery`. */
  delivery: string | undefined;
  /** `X-Publira-Event`. */
  event: string | undefined;
  verified: boolean;
}

const secrets = new Map<string, string>();
const deliveries = new Map<string, RecordedDelivery[]>();

const readBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString();
};

const answerJson = (
  response: ServerResponse,
  body: RecordedDelivery[] | { status: string }
): void => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

const answerEmpty = (response: ServerResponse, status: number): void => {
  response.writeHead(status);
  response.end();
};

/** The check `docs/en/4-console/10-api-keys-and-webhooks.md` tells a receiver to make. */
const verifies = (
  secret: string | undefined,
  header: string | undefined,
  body: string
): boolean => {
  if (!(secret && header)) {
    return false;
  }

  const parts = new Map(
    header.split(",").map((part) => {
      const [name = "", value = ""] = part.trim().split("=");

      return [name, value];
    })
  );

  const timestamp = parts.get("t") ?? "";

  const signature = Buffer.from(parts.get("v1") ?? "");

  const expected = Buffer.from(
    createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")
  );

  const age = Math.abs(
    Temporal.Now.instant().epochMilliseconds / 1000 - Number(timestamp)
  );

  return (
    age <= TOLERANCE_SECONDS &&
    signature.length === expected.length &&
    timingSafeEqual(signature, expected)
  );
};

createHttpsServer({ cert, key }, async (request, response) => {
  const name = (request.url ?? "/").slice(1);
  const body = await readBody(request);

  const verified = verifies(
    secrets.get(name),
    request.headers["x-publira-signature"]?.toString(),
    body
  );

  deliveries.set(name, [
    ...(deliveries.get(name) ?? []),
    {
      body: JSON.parse(body),
      delivery: request.headers["x-publira-delivery"]?.toString(),
      event: request.headers["x-publira-event"]?.toString(),
      verified,
    },
  ]);
  answerEmpty(response, verified ? 204 : 401);
}).listen(httpsPort, "127.0.0.1");

createServer(async (request, response) => {
  const pathname = request.url ?? "/";

  if (pathname === "/readyz") {
    answerJson(response, { status: "ok" });

    return;
  }

  const secretName = /^\/__e2e\/secrets\/(?<name>.+)$/u.exec(pathname)?.groups
    ?.name;

  if (secretName && request.method === "PUT") {
    secrets.set(secretName, await readBody(request));
    answerEmpty(response, 204);

    return;
  }

  const deliveriesName = /^\/__e2e\/deliveries\/(?<name>.+)$/u.exec(pathname)
    ?.groups?.name;

  if (deliveriesName) {
    answerJson(response, deliveries.get(deliveriesName) ?? []);

    return;
  }

  answerEmpty(response, 404);
}).listen(port, "127.0.0.1");
