/**
 * Identify which backend port received the request.
 *
 *     node e2e/routing/echo.ts
 *
 * The routing check puts one proxy in front of this process, which listens on
 * every backend port the contract names and echoes what arrived — the path,
 * and the headers the edge is supposed to have removed or set. That is how the
 * suite asserts the path each backend receives, host matching, and the request
 * headers each backend is promised.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";

/**
 * W3C Trace Context headers the edge drops. Echoing what the backend actually
 * received is how the suite asserts they are gone.
 */
const TRACE_CONTEXT_HEADERS = ["traceparent", "tracestate", "baggage"];

/**
 * The headers the edge sets for the backend. A caller can send all three, so
 * echoing them is how the suite asserts the edge replaced rather than kept
 * what arrived.
 */
const FORWARDED_HEADERS = [
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-for",
];

/**
 * Port → backend name. Must match the addresses the proxy under test is
 * given, which are the ports every backend listens on. The api backend
 * answers /images too, so there is no port of its own for the images.
 */
const BACKENDS = new Map([
  [3000, "web-host"],
  [4000, "web-admin"],
  [4100, "web-platform"],
  [8000, "api"],
]);

const METHODS = new Set(["GET", "HEAD", "POST"]);

/**
 * The first value of a request header, or `""` when it did not arrive.
 *
 * Node.js joins repeated headers into one comma-separated value, which would
 * turn two `X-Forwarded-For` lines into what looks like a list the edge
 * appended to. Reading the first line is what a backend's own header lookup
 * does.
 */
const firstHeader = (req: IncomingMessage, name: string): string =>
  req.headersDistinct[name]?.[0] ?? "";

const respond = (
  backend: string,
  port: number,
  req: IncomingMessage,
  res: ServerResponse
): void => {
  // The body is never read; drain it so the response is not held up.
  req.resume();

  // Close after every response. A proxy pools upstream connections for
  // longer than Node.js keeps an idle one open, and a request sent on a
  // connection this side has just closed comes back from the edge as a 502
  // that no probe can tell from a routing failure.
  res.setHeader("Connection", "close");
  res.setHeader("Server", "publira-routing-echo");

  if (!METHODS.has(req.method ?? "")) {
    res.writeHead(501, { Allow: [...METHODS].join(", ") });
    res.end();
    return;
  }

  const payload: Record<string, number | string> = {
    backend,
    host: firstHeader(req, "host"),
    method: req.method ?? "",
    path: req.url ?? "",
    port,
  };
  for (const name of [...TRACE_CONTEXT_HEADERS, ...FORWARDED_HEADERS]) {
    payload[name] = firstHeader(req, name);
  }
  const raw = Buffer.from(JSON.stringify(payload));

  res.writeHead(200, {
    "Content-Length": raw.byteLength,
    "Content-Type": "application/json",
    "X-Backend": backend,
    "X-Backend-Port": String(port),
  });
  res.end(req.method === "HEAD" ? undefined : raw);
};

for (const [port, backend] of BACKENDS) {
  const server = createServer((req, res) => {
    res.on("finish", () => {
      // Compose captures stdout; keep one line per request for triage.
      console.log(
        `${backend}:${port} ${req.method} ${req.url} HTTP/${req.httpVersion} ${res.statusCode}`
      );
    });
    respond(backend, port, req, res);
  });
  server.listen(port, "0.0.0.0", () => {
    console.log(`listening ${backend} on :${port}`);
  });
}
