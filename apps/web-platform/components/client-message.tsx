"use client";

import {
  getMessage,
  LOCALE_COOKIE_NAME,
  parseLocaleCookie,
} from "@publira/i18n";
import type { MessageValues } from "@publira/i18n";
import { use } from "react";

import { loadPlatformMessages } from "#lib/messages";
import type { PlatformMessageKey } from "#lib/messages";

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
/**
 * Catalog for client-only controls whose DOM APIs require a string attribute.
 * The hook stays local to that control; no catalog object crosses a component
 * boundary.
 */
export const useClientMessages = () => {
  const locale = parseLocaleCookie(readDocumentLocale());
  return use(loadPlatformMessages(locale));
};

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
