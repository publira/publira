"use client";

import { bindMessages } from "@publira/i18n";
import type { MessageValues } from "@publira/i18n";
import { use } from "react";

import { AdminMessagesContext } from "#components/admin-locale-context";
import type {
  AdminClientMessageAccessor,
  AdminClientMessageKey,
  AdminClientMessages,
} from "#lib/messages";

/**
 * The accessor a Client Component resolves its copy through, bound to the
 * catalog `AdminLocaleProvider` carries.
 *
 * On the server this waits on that read under the boundary the surrounding
 * section already sits behind. The read has settled in the payload by the time
 * the browser hydrates, so the copy is there on the first client render and no
 * catalog is loaded in the browser. Missing the provider is a wiring bug rather
 * than a case to fall back from — a component rendered outside one has no
 * locale to answer in. `app/[tenant_id]/error.tsx`, which renders above the
 * layout that places the provider, uses `<ErrorBoundaryMessage>` instead.
 */
export const useClientMessages = (): AdminClientMessageAccessor => {
  const messages = use(AdminMessagesContext);
  if (messages === null) {
    throw new Error("AdminLocaleProvider is required.");
  }

  const catalog: AdminClientMessages = use(messages);
  return bindMessages(catalog);
};

/** One catalog string rendered by a Client Component. */
export const ClientMessage = ({
  message,
  values,
}: {
  message: AdminClientMessageKey;
  values?: MessageValues;
}) => {
  const t = useClientMessages();

  return t(message, values);
};
