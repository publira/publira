import { ContentViewTargetType } from "@publira/api-client/public/catalog";
import { profileCookieName } from "@publira/web-session/cookie-name";
import { cookies } from "next/headers";
import { z } from "zod";

import { apiClient, resolveAccessToken } from "./api-client";

/** Detail pages this app records a soft page view for. */
export const contentViewKinds = ["episode", "series"] as const;
export type ContentViewKind = (typeof contentViewKinds)[number];

const contentViewTargetTypeByKind: Record<
  ContentViewKind,
  ContentViewTargetType
> = {
  episode: ContentViewTargetType.EPISODE,
  series: ContentViewTargetType.SERIES,
};

export interface ContentView {
  kind: ContentViewKind;
  publicId: string;
  tenantId: string;
}

/**
 * The cookie name the public API reads the anonymous view actor from.
 *
 * It is a **request** header this app writes, never a cookie the reader's
 * browser holds: the API's own `Set-Cookie` would be addressed to the API's
 * host, and the reader never talks to that host. The identifier the reader
 * carries lives in {@link VIEW_ACTOR_COOKIE_NAME} instead, on this app's own
 * terms, and is forwarded here on each recorded view.
 */
const API_ANONYMOUS_ID_COOKIE_NAME = "publira_aid";

/**
 * The signed-out reader's view actor, kept the same way as every other cookie
 * this app owns (#600): host-only, `HttpOnly`, `SameSite=Lax`, and `Secure`
 * outside development. The value is a UUID this app mints and nothing else —
 * no address, no user agent, no account — so it is stored as-is rather than
 * sealed like the session cookie.
 */
export const VIEW_ACTOR_COOKIE_NAME = profileCookieName(
  "publira_web_host_view_actor"
);

/**
 * Outlives the window that reads the raw events, so a returning reader is
 * still recognised as the same actor, and then expires rather than leaving an
 * abandoned identifier alive indefinitely. Matches the public API's own 180
 * days for the identifier it mints when a caller sends none.
 */
export const VIEW_ACTOR_COOKIE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

const viewActorCookieOptions = {
  httpOnly: true,
  maxAge: VIEW_ACTOR_COOKIE_MAX_AGE_SECONDS,
  path: "/",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

/**
 * A stored actor is accepted only when it is a non-nil UUID, which is exactly
 * what the API accepts. Anything else — a hand-edited cookie, a value from an
 * older format — is replaced rather than forwarded, so the request never
 * carries an identifier the API would silently discard.
 */
const viewActorIdSchema = z.uuid().refine((value) => value !== NIL_UUID);

const readStoredViewActorId = (raw: string | undefined): string => {
  const parsed = viewActorIdSchema.safeParse(raw?.trim() ?? "");
  return parsed.success ? parsed.data : "";
};

/**
 * The signed-out reader's actor, minting one on first view.
 *
 * **Route Handlers and Server Actions only.** Minting writes a cookie, which
 * needs a response whose headers are still open.
 */
const resolveAnonymousViewActorId = async (): Promise<string> => {
  const cookieStore = await cookies();
  const stored = readStoredViewActorId(
    cookieStore.get(VIEW_ACTOR_COOKIE_NAME)?.value
  );
  if (stored) {
    return stored;
  }

  const minted = crypto.randomUUID();
  cookieStore.set({
    ...viewActorCookieOptions,
    name: VIEW_ACTOR_COOKIE_NAME,
    value: minted,
  });
  return minted;
};

/**
 * Who the recorded view belongs to.
 *
 * A signed-in reader is attributed to their account, so the bearer is the only
 * thing sent and no anonymous identifier is minted for them. Everyone else is
 * attributed to the anonymous actor. The API decides between the two the same
 * way; sending both would only leave a second identifier on a reader who does
 * not need one.
 *
 * A bearer the API rejects — a session revoked since this app last sealed the
 * cookie — therefore arrives with nothing to attribute the view to, and the API
 * records nothing rather than minting an actor of its own. That is deliberate:
 * the identifier it minted would ride back on a `Set-Cookie` addressed to the
 * API's host, which the reader never talks to, so every later beacon would open
 * another single-use actor.
 */
const buildViewActorHeaders = async (): Promise<Record<string, string>> => {
  const accessToken = await resolveAccessToken();
  if (accessToken) {
    return { Authorization: `Bearer ${accessToken}` };
  }
  return {
    Cookie: `${API_ANONYMOUS_ID_COOKIE_NAME}=${await resolveAnonymousViewActorId()}`,
  };
};

/**
 * Record one soft page view for the detail page the reader has open.
 *
 * `RecordContentView` exists so this is the only thing that files a view. The
 * detail reads this app makes are `"use cache"`, so they cannot be the source:
 * a cache hit never reaches the API at all, and a cache fill reaches it
 * without the reader attached. This call is the reader's own — it runs from
 * the beacon endpoint, outside every cache, once per page actually opened, and
 * never on a prefetch because a prefetch renders nothing that could send a
 * beacon.
 *
 * Nothing is reported back. A page must not fail, change, or slow down over
 * its own instrumentation, so an unreachable API or a rejected call is
 * swallowed here the same way the API swallows a failed insert.
 */
export const recordContentView = async ({
  kind,
  publicId,
  tenantId,
}: ContentView): Promise<void> => {
  const headers = await buildViewActorHeaders();
  try {
    await apiClient.contentView.recordContentView(
      {
        target: { publicId, type: contentViewTargetTypeByKind[kind] },
        tenant: { tenantId },
      },
      { headers }
    );
  } catch {
    // An episode that has since been unpublished, a tenant that no longer
    // resolves, an API that is down: none of them are the reader's problem.
  }
};
