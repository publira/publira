"use client";

import {
  getMessage,
  LOCALE_COOKIE_NAME,
  parseLocaleCookie,
} from "@publira/i18n";
import type { Locale, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
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
  const locale = parseLocaleCookie(readDocumentLocale());
  const messages = use(adminCatalog(locale));

  return getMessage(messages, message, values);
};

/**
 * The active UI locale and catalog for Client Components.
 *
 * Content-entry forms need strings for native labels and component props, not
 * only JSX children. They must also be able to render their initial controls
 * before a route-level Suspense boundary is reached, so this hook uses the
 * synchronously available shared catalog. Locale-specific route copy still
 * loads lazily through {@link ClientMessage}.
 */
export const useAdminMessages = (): {
  locale: Locale;
  messages: AdminMessages;
} => {
  const locale = parseLocaleCookie(readDocumentLocale());
  const messages = sharedCatalog(locale);

  return { locale, messages };
};

/** Resolve a catalog message for a Client Component. */
export const useAdminMessage = () => {
  const { messages } = useAdminMessages();

  return (message: AdminMessageKey, values?: MessageValues): string =>
    getMessage(messages, message, values);
};
