"use client";

import {
  getMessage,
  LOCALE_COOKIE_NAME,
  negotiateInitialLocale,
  parseLocale,
  parseLocaleCookie,
  RESOLVED_LOCALE_COOKIE_NAME,
} from "@publira/i18n";
import type { Locale, MessageValues } from "@publira/i18n";
import { use } from "react";

import { loadPlatformMessages } from "#lib/messages";
import type { PlatformMessageKey, PlatformMessages } from "#lib/messages";

const readCookie = (name: string): string => {
  if (typeof document === "undefined") {
    return "";
  }

  const match = document.cookie.match(
    new RegExp(`(?:^|; )${name}=([^;]*)`, "u")
  );
  if (!match?.[1]) {
    return "";
  }

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
};

/**
 * The locale this chunk renders in, from the browser alone.
 *
 * The order is the one the server resolves in. `publira_locale` is the
 * operator's own choice; `publira_resolved_locale` is the saved platform
 * default, published by `proxy.ts` on the responses it routes precisely so
 * this chunk can read it — the platform API is out of reach here, because the
 * boundary that renders this is the one its failure brought up. `<html lang>`
 * comes next for a document whose language was decided some other way (the
 * switcher writes it once its Action resolves).
 *
 * Only a browser that has never had a console response — no cookie of either
 * kind — falls through to what it asked for, the same `Accept-Language`
 * preference the server negotiates from before a language has been saved.
 */
const readClientLocale = (): Locale => {
  if (typeof document === "undefined") {
    return negotiateInitialLocale(null);
  }

  return (
    parseLocaleCookie(readCookie(LOCALE_COOKIE_NAME)) ??
    parseLocaleCookie(readCookie(RESOLVED_LOCALE_COOKIE_NAME)) ??
    parseLocale(document.documentElement.lang) ??
    negotiateInitialLocale(navigator.languages.join(","))
  );
};

/**
 * One promise per locale, so `use()` sees the same promise on every render.
 * `loadPlatformMessages` is `async`, so calling it during render would hand
 * `use()` a new promise each time and React would suspend again on every retry.
 */
const catalogs = new Map<Locale, Promise<PlatformMessages>>();

const platformCatalog = (locale: Locale): Promise<PlatformMessages> => {
  const loaded = catalogs.get(locale);
  if (loaded) {
    return loaded;
  }

  const pending = loadPlatformMessages(locale);
  catalogs.set(locale, pending);

  return pending;
};

/**
 * Catalog for client-only controls whose DOM APIs require a string attribute.
 * The hook stays local to that control; no catalog object crosses a component
 * boundary.
 */
export const useClientMessages = () => use(platformCatalog(readClientLocale()));

/**
 * One catalog string for Client Components that cannot render `<Message>`.
 *
 * Route-level `error.tsx` files must be client, so they cannot import the
 * server `<Message>`. The locale cookie is not httpOnly, and this chunk is
 * isolated to the error boundary.
 *
 * **Wrap it in a `<Suspense>` at the call site**, the same as `<Message>`. An
 * error boundary directly under the root layout has no boundary of its own
 * above it, so a suspend with nothing to fall back to leaves React unable to
 * flush the error screen at all.
 *
 * The stored platform default is out of reach here — resolving it needs the
 * platform API, and the boundary that renders this is the one the API failing
 * brought up. The locale therefore comes from the browser
 * ({@link readClientLocale}), which is the last thing still standing.
 */
export const ClientMessage = ({
  message,
  values,
}: {
  message: PlatformMessageKey;
  values?: MessageValues;
}) => {
  const messages = useClientMessages();

  return getMessage(messages, message, values);
};
