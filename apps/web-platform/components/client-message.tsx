"use client";

import {
  getMessage,
  LOCALE_COOKIE_NAME,
  parseLocaleCookie,
} from "@publira/i18n";
import type { Locale, MessageValues } from "@publira/i18n";
import { use } from "react";

import { loadPlatformMessages } from "#lib/messages";
import type { PlatformMessageKey, PlatformMessages } from "#lib/messages";

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
export const useClientMessages = () =>
  use(platformCatalog(parseLocaleCookie(readDocumentLocale())));

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
 * The platform default locale is out of reach here — resolving it needs the
 * platform API, and the boundary that renders this is the one the API failing
 * brought up. An operator who has never switched languages therefore reads the
 * error screen in `ja` even when the console defaults to `en`.
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
