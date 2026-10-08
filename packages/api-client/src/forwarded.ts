import { createContextKey, createContextValues } from "@connectrpc/connect";
import type { ContextValues, Interceptor } from "@connectrpc/connect";

export const FORWARDED_FOR_HEADER = "X-Forwarded-For";

export const FORWARDED_HEADER = "Forwarded";

/**
 * The forwarded headers a call passes on. A header the request being served
 * did not carry is absent rather than empty.
 */
export type ForwardedHeaders = Partial<
  Record<typeof FORWARDED_FOR_HEADER | typeof FORWARDED_HEADER, string>
>;

/** Reads the forwarded headers of the request being served. */
export type ForwardedHeadersResolver = () => Promise<ForwardedHeaders>;

/**
 * The forwarded headers of the request being served, as the app passes them
 * on: each one it carries, unchanged.
 *
 * By the time route code reads them, `appendPeerAddressOnEveryRequest` from
 * `@publira/api-client/forwarded-hop` has appended the address the request
 * arrived from, so the chain the server walks runs through the app as through
 * any other hop. Neither header is rewritten into the other: the server reads
 * the one its settings name, and only the proxies in front know which of the
 * two they wrote.
 */
export const forwardedHeadersOf = (
  requestHeaders: Headers
): ForwardedHeaders => {
  const forwarded: ForwardedHeaders = {};
  for (const name of [FORWARDED_FOR_HEADER, FORWARDED_HEADER] as const) {
    const value = requestHeaders.get(name)?.trim();
    if (value) {
      forwarded[name] = value;
    }
  }
  return forwarded;
};

const serviceCallKey = createContextKey(false, {
  description: "a call the app makes as itself, not for one person",
});

/**
 * The context values of a call the app makes as itself, with the web service
 * credential rather than a person's session. Such a call carries
 * `Authorization` as a session does, so it has to say so for
 * {@link createForwardedInterceptor} to leave it alone.
 */
export const serviceCallContextValues = (): ContextValues =>
  createContextValues().set(serviceCallKey, true);

/**
 * Passes the forwarded headers of the request being served on with every call
 * that carries a session, so the API records the signed-in person's address
 * rather than the app server's.
 *
 * A session is what marks a call as made for one person. A service call is
 * not one: it runs inside a shared `"use cache"` scope, where the request state
 * the resolver reads is off limits, and its answer is the same whoever's
 * request filled the entry. A call that sets either header itself keeps what
 * it set.
 */
export const createForwardedInterceptor =
  (resolve: ForwardedHeadersResolver): Interceptor =>
  (next) =>
  async (req) => {
    if (
      req.header.has("Authorization") &&
      !req.header.has(FORWARDED_FOR_HEADER) &&
      !req.header.has(FORWARDED_HEADER) &&
      !req.contextValues.get(serviceCallKey)
    ) {
      for (const [name, value] of Object.entries(await resolve())) {
        req.header.set(name, value);
      }
    }
    return await next(req);
  };
