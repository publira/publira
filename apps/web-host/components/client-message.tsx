"use client";

import { getMessage } from "@publira/i18n";
import type { MessageValues } from "@publira/i18n";
import { use } from "react";

import { loadHostMessages } from "#lib/messages";
import type { HostMessageKey } from "#lib/messages";

import { useLocale } from "./locale-provider";

/**
 * The catalog, for a client-only control whose DOM API needs a plain string —
 * an `aria-label` or a `title` that cannot take a node.
 *
 * The locale comes from the route tree through `<LocaleProvider>`, so it is the
 * same value the server rendered with. Keep the hook local to the control that
 * needs it: a catalog object handed across a component boundary makes the key
 * an implicit attribute of whatever the caller happened to load.
 */
export const useHostMessages = () => use(loadHostMessages(useLocale()));

/**
 * One catalog string for a Client Component that cannot render `<Message>`.
 *
 * Route-level `error.tsx` files must be client components, so their copy
 * resolves in the browser rather than on the server.
 */
export const ClientMessage = ({
  message,
  values,
}: {
  message: HostMessageKey;
  values?: MessageValues;
}) => {
  const messages = useHostMessages();

  return getMessage(messages, message, values);
};
