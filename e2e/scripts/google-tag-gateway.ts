/**
 * Stands in for Google's tag gateway (`https://<tag ID>.fps.goog`) during an
 * E2E run, so the storefront's gateway path forwards somewhere a spec can see.
 *
 * web-storefront reaches it through `PUBLIRA_GOOGLE_TAG_GATEWAY_URL`, which
 * `lib.sh` points here, and names the tag in the `Host` it sends as it would
 * to Google. Every request on another path than the two below is recorded,
 * with its method, path and query, headers, and body, and answered as the
 * gateway would:
 *
 * - a path ending in `/` is a loader (`/<gateway path>/?id=<tag ID>`), and
 *   answers a script that marks the page with the tag it loaded and sends one
 *   hit for it to `g/collect` under the same path, as a tag sends its hits to
 *   the path it was loaded from;
 * - `…/g/collect` is a hit, and answers `204` setting two of Google's
 *   first-party cookies, alongside a `Set-Cookie` and a `Clear-Site-Data` the
 *   storefront must not pass on, so a spec can tell what reached the browser;
 * - `…/healthy` answers `ok`, as Google's does.
 *
 * `GET /__e2e/requests` answers what was recorded, oldest first, and
 * `DELETE /__e2e/requests` forgets it.
 */
import { once } from "node:events";
import { createServer } from "node:http";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";

const port = Number(process.env.PUBLIRA_E2E_GOOGLE_TAG_GATEWAY_PORT);

if (!Number.isInteger(port) || port <= 0) {
  throw new Error(
    "PUBLIRA_E2E_GOOGLE_TAG_GATEWAY_PORT must name the port to listen on"
  );
}

const origin = `http://127.0.0.1:${port}`;

interface RecordedRequest {
  body: string;
  headers: IncomingHttpHeaders;
  method: string;
  /** The path and query, as the storefront forwarded them. */
  url: string;
}

const recorded: RecordedRequest[] = [];

const readBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }

  return Buffer.concat(chunks).toString();
};

/**
 * The loader: it records which tag loaded on the page, and sends that tag's
 * hit to `g/collect` beside the loader's own path.
 */
const loaderScript = (tagId: string): string => `(() => {
  const state = (window.__e2eGatewayTag = window.__e2eGatewayTag || { loaded: [] });
  state.loaded.push(${JSON.stringify(tagId)});
  const loader = new URL(document.currentScript.src);
  const hit = new URL("g/collect", loader);
  hit.searchParams.set("v", "2");
  hit.searchParams.set("tid", ${JSON.stringify(tagId)});
  hit.searchParams.set("en", "page_view");
  fetch(hit, { body: "en=page_view", credentials: "include", keepalive: true, method: "POST" });
})();`;

const server = createServer(async (request, response) => {
  const url = request.url ?? "/";
  const { pathname, searchParams } = new URL(url, origin);

  if (pathname === "/readyz") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok" }));

    return;
  }

  if (pathname === "/__e2e/requests") {
    if (request.method === "DELETE") {
      recorded.length = 0;
      response.writeHead(204);
      response.end();

      return;
    }

    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(recorded));

    return;
  }

  recorded.push({
    body: await readBody(request),
    headers: request.headers,
    method: request.method ?? "GET",
    url,
  });

  if (pathname.endsWith("/healthy")) {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");

    return;
  }

  if (pathname.endsWith("/g/collect")) {
    response.writeHead(204, {
      "clear-site-data": '"cookies"',
      "set-cookie": [
        "FPLC=e2e-stand-in; Path=/; Max-Age=72000",
        "_ga=GA1.1.e2e-stand-in; Path=/; Max-Age=63072000",
        "publira_web_storefront_auth=; Path=/; Max-Age=0",
        "e2e_stand_in=1; Path=/",
      ],
    });
    response.end();

    return;
  }

  if (pathname.endsWith("/")) {
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "application/javascript; charset=utf-8",
    });
    response.end(loaderScript(searchParams.get("id") ?? ""));

    return;
  }

  response.writeHead(404, { "content-type": "text/plain" });
  response.end("not found");
});

server.listen(port, "127.0.0.1");

await once(server, "listening");

console.log(`google-tag-gateway stand-in listening on 127.0.0.1:${port}`);
