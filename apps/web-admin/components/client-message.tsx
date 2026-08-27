"use client";

import {
  getMessage,
  LOCALE_COOKIE_NAME,
  parseLocaleCookie,
} from "@publira/i18n";
import type { MessageValues } from "@publira/i18n";
import { use } from "react";

import { loadAdminMessages } from "#lib/messages";
import type { AdminMessageKey } from "#lib/messages";

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
 * One catalog string for Client Components that cannot render `<Message>`.
 *
 * Route-level `error.tsx` files must be client, so they cannot import the
 * server `<Message>`. The locale cookie is not httpOnly, and this chunk is
 * isolated to the error boundary.
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
  const messages = use(loadAdminMessages(locale));

  return getMessage(messages, message, values);
};
