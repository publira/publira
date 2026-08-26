"use client";

import {
  getMessage,
  LOCALE_COOKIE_NAME,
  parseLocaleCookie,
} from "@publira/utils/i18n";
import type { MessageValues } from "@publira/utils/i18n";
import { use } from "react";

import { loadPlatformMessages } from "#lib/locale";
import type { PlatformMessageKey } from "#lib/locale";

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
 */
export const ClientMessage = ({
  message,
  values,
}: {
  message: PlatformMessageKey;
  values?: MessageValues;
}) => {
  const locale = parseLocaleCookie(readDocumentLocale());
  const messages = use(loadPlatformMessages(locale));

  return getMessage(messages, message, values);
};
