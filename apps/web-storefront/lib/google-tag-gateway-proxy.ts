import { once } from "node:events";
import { request as httpRequest } from "node:http";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import type { RequestOptions } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";

import { NextResponse } from "next/server";
import { z } from "zod";

import type { GoogleTagGateway } from "./google-tag-gateway";
import { resolvePublicAddress } from "./public-address";

/**
 * Replaces the origin Google's gateway is reached on, `https://<tag ID>.fps.goog`,
 * while the `Host` sent still names the tag. Unset in every deployment: the E2E
 * stack points it at its stand-in for Google.
 */
export const GOOGLE_TAG_GATEWAY_URL_ENV = "PUBLIRA_GOOGLE_TAG_GATEWAY_URL";

/**
 * The first-party cookies Google's tags set on the site's own domain: Google
 * Analytics (`_ga`, `_ga_<container>`, `_gid`, `_gat…`), Google Ads and
 * Floodlight (`_gcl_…`, `_gac_…`, `_dc_gtm_…`), and the ones a server
 * container sets (`FPID`, `FPLC`, `FPAU`, `FPGSID`, `FPGCL…`). No other
 * cookie of the site leaves Publira through the gateway, in either direction.
 */
const GOOGLE_COOKIE_NAMES: ReadonlySet<string> = new Set([
  "_ga",
  "_gid",
  "FPAU",
  "FPGSID",
  "FPID",
  "FPLC",
]);

const GOOGLE_COOKIE_PREFIXES = [
  "_ga_",
  "_gac_",
  "_gat",
  "_gcl_",
  "_dc_gtm_",
  "FPGCL",
] as const;

export const isGoogleCookieName = (name: string): boolean =>
  GOOGLE_COOKIE_NAMES.has(name) ||
  GOOGLE_COOKIE_PREFIXES.some((prefix) => name.startsWith(prefix));

/**
 * The request headers a tag's script load or hit is forwarded with: what the
 * response is negotiated by, and what describes the browser and the page.
 * Everything else stays behind — `Authorization`, the forwarded headers the
 * edge wrote, and every header this list does not name.
 */
const FORWARDED_REQUEST_HEADERS: ReadonlySet<string> = new Set([
  "accept",
  "accept-encoding",
  "accept-language",
  "cache-control",
  "content-type",
  "if-modified-since",
  "if-none-match",
  "origin",
  "pragma",
  "referer",
  "user-agent",
]);

const FORWARDED_REQUEST_HEADER_PREFIXES = ["sec-ch-", "sec-fetch-"] as const;

/**
 * The reader's region, which the edge hands over as an ISO 3166-2 subdivision
 * code such as `JP-13`, under the name Google's gateway reads it by. The edge
 * removes the header from every request it does not set it on, so a value
 * that arrived is the edge's; one of another shape is left out rather than
 * passed on for Google to misread.
 */
const COUNTRY_REGION_HEADER = "x-forwarded-countryregion";

const countryRegionSchema = z
  .string()
  .trim()
  .regex(/^[A-Z]{2}-[A-Z0-9]{1,3}$/u);

/**
 * The response headers passed back: what describes the body and how it may
 * be cached and shared. A header an upstream could act on the site with —
 * `Clear-Site-Data`, `Strict-Transport-Security`, a policy of its own — is
 * not, since the server container's is one the tenant runs.
 */
const PASSED_RESPONSE_HEADERS: ReadonlySet<string> = new Set([
  "access-control-allow-credentials",
  "access-control-allow-headers",
  "access-control-allow-methods",
  "access-control-allow-origin",
  "access-control-expose-headers",
  "access-control-max-age",
  "cache-control",
  "content-encoding",
  "content-language",
  "content-type",
  "cross-origin-resource-policy",
  "etag",
  "expires",
  "last-modified",
  "location",
  "timing-allow-origin",
  "vary",
  "x-content-type-options",
]);

const cookieName = (pair: string): string => {
  const separator = pair.indexOf("=");

  return (separator === -1 ? "" : pair.slice(0, separator)).trim();
};

/** The headers of an upstream request, which always names its `host`. */
export interface UpstreamRequestHeaders {
  [name: string]: string;
  host: string;
}

/**
 * The headers the gateway sends upstream for a request that arrived with
 * `incoming`.
 *
 * `host` names the upstream, as its own `Host` would. `clientAddress` goes in
 * `X-Forwarded-For` alone, so Google sees the reader rather than the app;
 * without one the header is left out rather than guessed, and so is the
 * reader's region without one from the edge.
 */
export const gatewayRequestHeaders = (
  incoming: Headers,
  { clientAddress, host }: { clientAddress: string | null; host: string }
): UpstreamRequestHeaders => {
  const headers: Record<string, string> = {};

  for (const [name, value] of incoming) {
    if (
      FORWARDED_REQUEST_HEADERS.has(name) ||
      FORWARDED_REQUEST_HEADER_PREFIXES.some((prefix) =>
        name.startsWith(prefix)
      )
    ) {
      headers[name] = value;
    }
  }

  const cookie = (incoming.get("cookie") ?? "")
    .split(";")
    .map((pair) => pair.trim())
    .filter((pair) => isGoogleCookieName(cookieName(pair)))
    .join("; ");

  if (cookie) {
    headers.cookie = cookie;
  }

  if (clientAddress) {
    headers["x-forwarded-for"] = clientAddress;
  }

  const countryRegion = countryRegionSchema.safeParse(
    incoming.get(COUNTRY_REGION_HEADER)
  );

  if (countryRegion.success) {
    headers[COUNTRY_REGION_HEADER] = countryRegion.data;
  }

  return { ...headers, host };
};

/**
 * The headers passed back to the browser from the upstream's `received`:
 * those {@link PASSED_RESPONSE_HEADERS} names, and a `Set-Cookie` only for a
 * Google cookie, so the upstream can neither replace nor clear one of the
 * site's own.
 */
export const gatewayResponseHeaders = (
  received: IncomingHttpHeaders
): Headers => {
  const headers = new Headers();

  for (const [name, value] of Object.entries(received)) {
    if (value === undefined) {
      continue;
    }

    if (name === "set-cookie") {
      for (const cookie of [value].flat()) {
        if (isGoogleCookieName(cookieName(cookie))) {
          headers.append("set-cookie", cookie);
        }
      }
    } else if (PASSED_RESPONSE_HEADERS.has(name)) {
      headers.set(name, [value].flat().join(", "));
    }
  }

  return headers;
};

interface UpstreamTarget {
  /** Whether only a public address of `origin`'s host may be connected to. */
  checkAddress: boolean;
  /** The `Host` sent. */
  host: string;
  origin: URL;
}

const readGatewayUrlOverride = (): URL | null => {
  const raw = (process.env[GOOGLE_TAG_GATEWAY_URL_ENV] ?? "").trim();

  if (!raw) {
    return null;
  }

  const url = URL.canParse(raw) ? new URL(raw) : null;

  if (!(url?.protocol === "http:" || url?.protocol === "https:")) {
    throw new Error(
      `${GOOGLE_TAG_GATEWAY_URL_ENV} must be an absolute http or https URL, not ${JSON.stringify(raw)}`
    );
  }

  return url;
};

/**
 * Where a gateway's request goes, under which `Host`, and whether its address
 * is checked.
 *
 * Google's gateway is reached on the tag's own host. The server container's
 * origin is one the tenant typed, and is connected to only on a public
 * address; Google's is held to the same check, which costs it nothing. The
 * origin {@link GOOGLE_TAG_GATEWAY_URL_ENV} names is the operator's, and is
 * connected to wherever it is.
 */
const upstreamTarget = ({ upstream }: GoogleTagGateway): UpstreamTarget => {
  if (upstream.mode === "server_container") {
    const origin = new URL(upstream.origin);

    return { checkAddress: true, host: origin.host, origin };
  }

  const host = `${upstream.tagId}.fps.goog`;
  const override = readGatewayUrlOverride();

  return override
    ? { checkAddress: false, host, origin: override }
    : { checkAddress: true, host, origin: new URL(`https://${host}`) };
};

/** How long the upstream may stay silent, before its answer and within it. */
const UPSTREAM_IDLE_TIMEOUT_MS = 10_000;

class UpstreamTimeoutError extends Error {
  constructor() {
    super("the upstream stayed silent");
    this.name = "UpstreamTimeoutError";
  }
}

const bodylessStatus = (method: string, status: number): boolean =>
  method === "HEAD" || status === 204 || status === 304;

const textResponse = (status: 502 | 504, body: string): NextResponse =>
  new NextResponse(body, {
    headers: { "cache-control": "no-store", "content-type": "text/plain" },
    status,
  });

/**
 * Forwards a request to the gateway's path upstream, path and query
 * unchanged, and streams the answer back.
 *
 * It goes out over `node:http(s)` rather than `fetch`, which Next.js would
 * offer its data cache: neither the request nor its answer is cached by the
 * app, and the browser keeps whatever caching the upstream asks for. The
 * connection is opened to the address {@link resolvePublicAddress} checked,
 * with TLS still verified against the host's name, and a redirect is passed
 * back to the browser rather than followed, so every connection this makes is
 * to an address that passed the check.
 *
 * An upstream that cannot be reached, or resolves to no public address,
 * answers `502`; one that stays silent answers `504`. Silence after the
 * headers, or a reader who leaves, fails the body stream alone.
 * `idleTimeoutMs` is how long that silence may last.
 */
export const forwardToGoogleTagGateway = async (
  request: Request,
  gateway: GoogleTagGateway,
  clientAddress: string | null,
  { idleTimeoutMs = UPSTREAM_IDLE_TIMEOUT_MS }: { idleTimeoutMs?: number } = {}
): Promise<NextResponse> => {
  const target = upstreamTarget(gateway);
  const incomingUrl = new URL(request.url);

  const url = new URL(
    `${incomingUrl.pathname}${incomingUrl.search}`,
    target.origin
  );

  const method = request.method.toUpperCase();

  const body =
    method === "GET" || method === "HEAD"
      ? null
      : Buffer.from(await request.arrayBuffer());

  const headers = gatewayRequestHeaders(request.headers, {
    clientAddress,
    host: target.host,
  });

  if (body) {
    headers["content-length"] = String(body.byteLength);
  }

  const send = url.protocol === "https:" ? httpsRequest : httpRequest;
  const hostname = url.hostname.replaceAll(/^\[|\]$/gu, "");

  let received: IncomingMessage;

  try {
    const options: RequestOptions = {
      headers,
      hostname: target.checkAddress
        ? await resolvePublicAddress(hostname)
        : hostname,
      method,
      path: `${url.pathname}${url.search}`,
      port: url.port || undefined,
      protocol: url.protocol,
      // The name TLS is verified against, since the socket is opened to an
      // address. An IP address is not a server name and is left to Node.js.
      ...(isIP(hostname) === 0 && { servername: hostname }),
      signal: request.signal,
    };

    const outgoing = send(options);
    outgoing.setTimeout(idleTimeoutMs, () => {
      outgoing.destroy(new UpstreamTimeoutError());
    });
    outgoing.end(body ?? undefined);
    // Rejects with the request's `error`.
    // SAFETY: a `ClientRequest` emits `response` with the one `IncomingMessage`.
    [received] = (await once(outgoing, "response")) as [IncomingMessage];
  } catch (error) {
    // A reader who left the page is not the upstream's failure.
    if (!request.signal.aborted) {
      console.warn(
        `[web-storefront] google tag gateway: ${url.origin} failed`,
        error
      );
    }

    return error instanceof UpstreamTimeoutError
      ? textResponse(504, "Gateway Timeout")
      : textResponse(502, "Bad Gateway");
  }

  const status = received.statusCode ?? 502;

  if (status < 200 || status > 599) {
    received.resume();

    return textResponse(502, "Bad Gateway");
  }

  if (bodylessStatus(method, status)) {
    received.resume();
  }

  received.setTimeout(idleTimeoutMs, () => {
    received.destroy(new UpstreamTimeoutError());
  });

  // SAFETY: `received` has no encoding set, so every chunk it yields is a
  // `Buffer`, which is a `Uint8Array`.
  return new NextResponse(
    bodylessStatus(method, status)
      ? null
      : (Readable.toWeb(received) as ReadableStream<Uint8Array>),
    { headers: gatewayResponseHeaders(received.headers), status }
  );
};
