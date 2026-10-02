import { createContextKey, createContextValues } from "@connectrpc/connect";
import type { ContextValues, Interceptor } from "@connectrpc/connect";

export const FORWARDED_FOR_HEADER = "X-Forwarded-For";

/** Reads the `X-Forwarded-For` the edge set on the request being served. */
export type ForwardedForResolver = () => Promise<string | null | undefined>;

const serviceCallKey = createContextKey(false, {
  description: "a call the app makes as itself, not for one person",
});

/**
 * The context values of a call the app makes as itself, with the web service
 * credential rather than a person's session. Such a call carries
 * `Authorization` as a session does, so it has to say so for
 * {@link createForwardedForInterceptor} to leave it alone.
 */
export const serviceCallContextValues = (): ContextValues =>
  createContextValues().set(serviceCallKey, true);

/**
 * Passes the edge's `X-Forwarded-For` on with every call that carries a
 * session, so the API records the signed-in person's address rather than the
 * app server's.
 *
 * A session is what marks a call as made for one person. A service call is
 * not one: it runs inside a shared `"use cache"` scope, where the request state
 * the resolver reads is off limits, and its answer is the same whoever's
 * request filled the entry.
 */
export const createForwardedForInterceptor =
  (resolve: ForwardedForResolver): Interceptor =>
  (next) =>
  async (req) => {
    if (
      req.header.has("Authorization") &&
      !req.header.has(FORWARDED_FOR_HEADER) &&
      !req.contextValues.get(serviceCallKey)
    ) {
      const resolved = await resolve();
      const forwardedFor = resolved?.trim();
      if (forwardedFor) {
        req.header.set(FORWARDED_FOR_HEADER, forwardedFor);
      }
    }
    return await next(req);
  };
