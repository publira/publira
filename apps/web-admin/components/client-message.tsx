"use client";

import {
  getMessage,
  LOCALE_COOKIE_NAME,
  parseLocaleCookie,
} from "@publira/i18n";
import type { Locale, MessageValues } from "@publira/i18n";
import { use } from "react";

import { FALLBACK_LOCALE } from "#lib/fallback-locale";
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
 * The tenant default locale is out of reach here — resolving it needs the
 * admin API, and the boundary that renders this is the one the API failing
 * brought up. An operator who has never switched languages therefore reads
 * the error screen in `ja` even when their tenant defaults to `en`.
 */
export const ClientMessage = ({
  message,
  values,
}: {
  message: AdminMessageKey;
  values?: MessageValues;
}) => {
  const locale = parseLocaleCookie(readDocumentLocale()) ?? FALLBACK_LOCALE;
  const messages = use(adminCatalog(locale));

  return getMessage(messages, message, values);
};
