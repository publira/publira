"use client";

import { bindMessages } from "@publira/i18n";
import type { MessageValues } from "@publira/i18n";
import { use } from "react";

import type {
  PlatformMessageAccessor,
  PlatformMessageKey,
} from "#lib/messages";

import { PlatformMessagesContext } from "./platform-messages-context";

/**
 * The accessor a Client Component resolves its copy through, bound to the
 * catalog `PlatformMessagesProvider` carries.
 *
 * On the server this waits on that read under the boundary the surrounding
 * section already sits behind. The read has settled in the payload by the time
 * the browser hydrates, so the copy is there on the first client render and no
 * catalog is loaded in the browser. A route-level `error.tsx` uses
 * `<ErrorBoundaryMessage>` instead.
 */
export const useClientMessages = (): PlatformMessageAccessor => {
  const messages = use(PlatformMessagesContext);
  if (messages === null) {
    throw new Error("PlatformMessagesProvider is required.");
  }

  return bindMessages(use(messages));
};

/** One catalog string rendered by a Client Component. */
export const ClientMessage = ({
  message,
  values,
}: {
  message: PlatformMessageKey;
  values?: MessageValues;
}) => {
  const t = useClientMessages();

  return t(message, values);
};
