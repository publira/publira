"use client";

import { bindMessages } from "@publira/i18n";
import type { MessageValues } from "@publira/i18n";
import { use } from "react";

import { AdminMessagesContext } from "#components/admin-locale-context";
import type { AdminMessageAccessor, AdminMessageKey } from "#lib/messages";

/**
 * The accessor a Client Component resolves its copy through, bound to the
 * catalog `AdminLocaleProvider` carries.
 *
 * It does not suspend: the server resolved the catalog for the request, so no
 * `<Suspense>` is needed around a caller. Missing the provider is a wiring bug
 * rather than a case to fall back from — a component rendered outside one has
 * no locale to answer in. `app/[tenant_id]/error.tsx`, which renders above the
 * layout that seeds the provider, uses `<ErrorBoundaryMessage>` instead.
 */
export const useClientMessages = (): AdminMessageAccessor => {
  const messages = use(AdminMessagesContext);
  if (messages === null) {
    throw new Error("AdminLocaleProvider is required.");
  }

  return bindMessages(messages);
};

/** One catalog string rendered by a Client Component. */
export const ClientMessage = ({
  message,
  values,
}: {
  message: AdminMessageKey;
  values?: MessageValues;
}) => {
  const t = useClientMessages();

  return t(message, values);
};
