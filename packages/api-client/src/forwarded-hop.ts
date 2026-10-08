import { subscribe } from "node:diagnostics_channel";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";

const headerValue = (
  value: string | string[] | undefined
): string | undefined =>
  (Array.isArray(value) ? value.join(", ") : value)?.trim() || undefined;

/**
 * The address as an RFC 7239 node: an IPv6 address is bracketed, and the
 * brackets and colons make it a value that has to be quoted.
 */
const forwardedNode = (address: string): string =>
  address.includes(":") ? `"[${address}]"` : address;

/**
 * Appends the address a request arrived from to its forwarded headers, as a
 * proxy does: `, <address>` to an `X-Forwarded-For` and `, for=<address>` to a
 * `Forwarded` that arrived, and an `X-Forwarded-For` carrying the address alone
 * when neither did. What arrived is kept as it is in front of the address.
 */
export const appendPeerAddress = (
  headers: IncomingHttpHeaders,
  peerAddress: string | undefined
): void => {
  if (!peerAddress) {
    return;
  }
  const forwardedFor = headerValue(headers["x-forwarded-for"]);
  const forwarded = headerValue(headers.forwarded);
  if (forwarded) {
    headers.forwarded = `${forwarded}, for=${forwardedNode(peerAddress)}`;
  }
  if (forwardedFor) {
    headers["x-forwarded-for"] = `${forwardedFor}, ${peerAddress}`;
  } else if (!forwarded) {
    headers["x-forwarded-for"] = peerAddress;
  }
};

const onRequestStart = (message: unknown): void => {
  const { request } = message as { request: IncomingMessage };
  appendPeerAddress(request.headers, request.socket.remoteAddress);
};

/**
 * Makes the app a hop in the forwarded chain the server walks: every request
 * the process's HTTP server receives has the address it arrived from appended
 * by {@link appendPeerAddress} before the app sees it, so what
 * `forwardedHeadersOf` reads and the API client passes on ends in the proxy in
 * front of the app.
 *
 * Next.js gives route code no address for the connection, so the address is
 * taken from the socket through Node.js's `http.server.request.start`
 * diagnostics channel, which publishes each request before the server emits
 * it to Next.js. Call it from `register()` in `instrumentation.ts`, which
 * Next.js runs in the process that serves the requests and finishes before it
 * serves the first.
 */
export const appendPeerAddressOnEveryRequest = (): void => {
  subscribe("http.server.request.start", onRequestStart);
};
