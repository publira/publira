import type { Interceptor } from "@connectrpc/connect";

export const FORWARDED_FOR_HEADER = "X-Forwarded-For";

/** Reads the `X-Forwarded-For` the edge set on the request being served. */
export type ForwardedForResolver = () => Promise<string | null | undefined>;

/**
 * Passes the edge's `X-Forwarded-For` on with every call that carries a
 * session, so the API records the signed-in person's address rather than the
 * app server's.
 *
 * A session is what marks a call as made for one person: a shared `"use cache"`
 * scope never holds one, and the request state the resolver reads is off limits
 * there.
 */
export const createForwardedForInterceptor =
  (resolve: ForwardedForResolver): Interceptor =>
  (next) =>
  async (req) => {
    if (
      req.header.has("Authorization") &&
      !req.header.has(FORWARDED_FOR_HEADER)
    ) {
      const resolved = await resolve();
      const forwardedFor = resolved?.trim();
      if (forwardedFor) {
        req.header.set(FORWARDED_FOR_HEADER, forwardedFor);
      }
    }
    return await next(req);
  };
