"use client";

import { bindMessages } from "@publira/i18n";
import type { MessageValues } from "@publira/i18n";
import { use } from "react";

import type {
  HostClientMessageAccessor,
  HostClientMessageKey,
} from "#lib/messages";

import { HostMessagesContext } from "./host-messages-context";

/**
 * The accessor, for a client-only control whose DOM API needs a plain string —
 * an `aria-label` or a `title` that cannot take a node.
 *
 * The catalog comes from `<HostMessagesProvider>`. On the server this waits on
 * that read; it has settled in the payload by the time the browser hydrates,
 * so the copy is there on the first client render and a caller needs no
 * `<Suspense>`. Keep the hook local to the control that needs it: an accessor
 * handed across a component boundary makes the key an implicit attribute of
 * whatever the caller happened to bind.
 */
export const useClientMessages = (): HostClientMessageAccessor => {
  const messages = use(HostMessagesContext);
  if (messages === null) {
    throw new Error("HostMessagesProvider is required.");
  }

  const catalog = use(messages);
  return bindMessages(catalog);
};

/** One catalog string rendered by a Client Component. */
export const ClientMessage = ({
  message,
  values,
}: {
  message: HostClientMessageKey;
  values?: MessageValues;
}) => {
  const t = useClientMessages();

  return t(message, values);
};
