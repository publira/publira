"use client";

import {
  getMessage,
  LOCALE_COOKIE_NAME,
  negotiateInitialLocale,
  parseLocale,
  parseLocaleCookie,
} from "@publira/i18n";
import type { Locale, MessageValues } from "@publira/i18n";
import { use } from "react";

import { loadAdminMessages } from "#lib/messages";
import type { AdminMessageKey, AdminMessages } from "#lib/messages";

const readDocumentLocale = (): string => {
  if (typeof document === "undefined") {
    return "";
  }

  const match = document.cookie.match(
    new RegExp(`(?:^|; )${LOCALE_COOKIE_NAME}=([^;]*)`, "u")
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
 * The cookie is the operator's own choice, and `<html lang>` is the tenant
 * default the root layout resolved for this document — the script has already
 * narrowed it to the cookie by the time any component runs. Only a tenant whose
 * default could not be read leaves both empty, and then the browser's own
 * `Accept-Language` preference is the last thing still standing.
 */
const readClientLocale = (): Locale => {
  if (typeof document === "undefined") {
    return negotiateInitialLocale(null);
  }

  return (
    parseLocaleCookie(readDocumentLocale()) ??
    parseLocale(document.documentElement.lang) ??
    negotiateInitialLocale(navigator.languages.join(","))
  );
};

/**
 * One promise per locale, so `use()` sees the same promise on every render.
 * `loadAdminMessages` is `async`, so calling it during render would hand `use()`
 * a new promise each time and React would suspend again on every retry.
 */
const catalogs = new Map<Locale, Promise<AdminMessages>>();

const adminCatalog = (locale: Locale): Promise<AdminMessages> => {
  const loaded = catalogs.get(locale);
  if (loaded) {
    return loaded;
  }

  const pending = loadAdminMessages(locale);
  catalogs.set(locale, pending);

  return pending;
};

/**
 * One catalog string for Client Components that cannot render `<Message>`.
 *
 * Route-level `error.tsx` files must be client, so they cannot import the
 * server `<Message>`. The locale cookie is not httpOnly, and this chunk is
 * isolated to the error boundary.
 *
 * **Wrap it in a `<Suspense>` at the call site**, the same as `<Message>`. An
 * error boundary has no boundary of its own above it, so a suspend with
 * nothing to fall back to leaves React unable to flush the error screen at all.
 *
 * The admin API is out of reach here — the boundary that renders this is the
 * one its failing brought up — so the locale comes from the browser
 * ({@link readClientLocale}) rather than from a fresh read.
 */
export const ClientMessage = ({
  message,
  values,
}: {
  message: AdminMessageKey;
  values?: MessageValues;
}) => {
  const messages = use(adminCatalog(readClientLocale()));

  return getMessage(messages, message, values);
};
