import { ContentViewTargetType } from "@publira/api-client/public/catalog";
import { ClientSurface } from "@publira/api-client/public/types";
import { profileCookieName } from "@publira/web-session/cookie-name";
import { cookies } from "next/headers";
import { z } from "zod";

import {
  apiClient,
  buildClientAddressHeaders,
  resolveAccessToken,
} from "./api-client";

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
  /** The internal ID of the series or episode the page shows. */
  id: string;
  kind: ContentViewKind;
  tenantId: string;
}

/**
 * The cookie name the public API reads the anonymous view actor from, and
 * mints one under in `Set-Cookie` when a call carries none.
 *
 * It is a **request** header this app writes, never a cookie the reader's
 * browser holds: the API's own `Set-Cookie` would be addressed to the API's
 * host, and the reader never talks to that host. This app reads the value out
 * of that `Set-Cookie` instead, keeps it in {@link VIEW_ACTOR_COOKIE_NAME} on
 * its own terms, and forwards it here on each recorded view.
 */
const API_ANONYMOUS_ID_COOKIE_NAME = "publira_aid";

/**
 * The signed-out reader's view actor, kept the same way as every other cookie
 * this app owns: host-only, `HttpOnly`, `SameSite=Lax`, and `Secure`
 * outside development. The value is the identifier the API minted, signed by
 * the API so that nobody can make one up, and nothing else — no address, no
 * user agent, no account — so it is stored as-is rather than sealed like the
 * session cookie.
 */
export const VIEW_ACTOR_COOKIE_NAME = profileCookieName(
  "publira_web_storefront_view_actor"
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

/**
 * What a stored actor has to look like to be forwarded at all. The value is
 * the API's and opaque here: only the API can tell whether it minted it, and
 * it answers one it did not with a fresh identifier, which replaces it. This
 * only keeps out of the request a value that could not be one — empty, too
 * long, or holding a character a `Cookie` header cannot carry.
 */
const viewActorIdSchema = z
  .string()
  .max(128)
  .regex(/^[\w.-]+$/u);

const readStoredViewActorId = (raw: string | undefined): string => {
  const parsed = viewActorIdSchema.safeParse(raw?.trim() ?? "");

  return parsed.success ? parsed.data : "";
};

/** The identifier the API minted in a `Set-Cookie` of its response, if any. */
const mintedViewActorId = (header: Headers): string => {
  for (const setCookie of header.getSetCookie()) {
    const [pair = ""] = setCookie.split(";", 1);
    const separator = pair.indexOf("=");

    if (
      separator > 0 &&
      pair.slice(0, separator).trim() === API_ANONYMOUS_ID_COOKIE_NAME
    ) {
      return readStoredViewActorId(pair.slice(separator + 1));
    }
  }

  return "";
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
 *
 * A reader who carries no actor yet sends none, and the API mints one. This
 * app mints none of its own: the API files a view only under an identifier it
 * signed, so one made up here would be replaced on every call.
 *
 * The anonymous call carries the reader's address as well, which a call with a
 * session gets from the client's interceptor, so that `publira server` charges
 * it to the reader's own allowances. Without it the call reaches the API as
 * one of this app's own, which no allowance counts.
 */
const buildViewActorHeaders = async (): Promise<{
  anonymous: boolean;
  headers: Record<string, string>;
}> => {
  const accessToken = await resolveAccessToken();

  if (accessToken) {
    return {
      anonymous: false,
      headers: { Authorization: `Bearer ${accessToken}` },
    };
  }

  const [{ headers: clientAddress }, cookieStore] = await Promise.all([
    buildClientAddressHeaders(),
    cookies(),
  ]);

  const actorId = readStoredViewActorId(
    cookieStore.get(VIEW_ACTOR_COOKIE_NAME)?.value
  );

  return {
    anonymous: true,
    headers: actorId
      ? {
          ...clientAddress,
          Cookie: `${API_ANONYMOUS_ID_COOKIE_NAME}=${actorId}`,
        }
      : clientAddress,
  };
};

/**
 * Keeps the identifier the API minted for the reader, so their next view is
 * filed under the same actor.
 *
 * **Route Handlers and Server Actions only.** It writes a cookie, which needs
 * a response whose headers are still open.
 */
const storeViewActorId = async (value: string): Promise<void> => {
  const cookieStore = await cookies();

  cookieStore.set({
    ...viewActorCookieOptions,
    name: VIEW_ACTOR_COOKIE_NAME,
    value,
  });
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
  id,
  kind,
  tenantId,
}: ContentView): Promise<void> => {
  const { anonymous, headers } = await buildViewActorHeaders();
  let minted = "";

  try {
    await apiClient.contentView.recordContentView(
      {
        surface: ClientSurface.WEB,
        target: { id, type: contentViewTargetTypeByKind[kind] },
        tenant: { tenantId },
      },
      {
        headers,
        onHeader: (header) => {
          minted = mintedViewActorId(header);
        },
      }
    );
  } catch {
    // An episode that has since been unpublished, a tenant that no longer
    // resolves, an API that is down, a client past its allowance: none of
    // them are the reader's problem.
  }

  // The API mints nothing for a call that carried a bearer, so an identifier
  // only ever comes back to a signed-out reader.
  if (anonymous && minted) {
    await storeViewActorId(minted);
  }
};
