/**
 * Stands in for Apple's and Google's signing keys during an E2E run.
 *
 * publira server reads its key set from `GET /keys` through
 * `PUBLIRA_SIGN_IN_APPLE_KEYS_URL` and `PUBLIRA_SIGN_IN_GOOGLE_KEYS_URL`, and a
 * spec signs the ID token a provider would have issued with `POST /id-tokens`.
 * The key pair lives only in this process, so nothing outside a run can sign a
 * token the run's server accepts.
 */
import "temporal-polyfill/global";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

/** How long a token signed without an `exp` of its own stays valid. */
const TOKEN_LIFETIME_SECONDS = 600;

const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port <= 0) {
  throw new Error("PORT must name the port to listen on");
}

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const keyId = randomUUID();
const keySet = JSON.stringify({
  keys: [
    {
      ...publicKey.export({ format: "jwk" }),
      alg: "RS256",
      kid: keyId,
      use: "sig",
    },
  ],
});

const base64url = (value: string | Buffer): string =>
  Buffer.from(value).toString("base64url");

const signToken = (claims: Record<string, unknown>): string => {
  const now = Math.floor(Temporal.Now.instant().epochMilliseconds / 1000);
  const header = base64url(
    JSON.stringify({ alg: "RS256", kid: keyId, typ: "JWT" })
  );
  const payload = base64url(
    JSON.stringify({ exp: now + TOKEN_LIFETIME_SECONDS, iat: now, ...claims })
  );
  const signature = sign(
    "sha256",
    Buffer.from(`${header}.${payload}`),
    privateKey
  );
  return `${header}.${payload}.${base64url(signature)}`;
};

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

const handle = async (
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> => {
  if (request.method === "GET" && request.url === "/readyz") {
    answer(response, 200, "application/json", '{"status":"ok"}');
    return;
  }
  if (request.method === "GET" && request.url === "/keys") {
    answer(response, 200, "application/json", keySet);
    return;
  }
  if (request.method === "POST" && request.url === "/id-tokens") {
    const claims: unknown = JSON.parse(await readBody(request));
    if (
      typeof claims !== "object" ||
      claims === null ||
      Array.isArray(claims)
    ) {
      answer(response, 400, "text/plain", "the body must be a JSON object");
      return;
    }
    answer(response, 200, "text/plain", signToken({ ...claims }));
    return;
  }
  answer(response, 404, "text/plain", "not found");
};

createServer(async (request, response) => {
  try {
    await handle(request, response);
  } catch (error) {
    answer(response, 400, "text/plain", String(error));
  }
}).listen(port, "127.0.0.1");
