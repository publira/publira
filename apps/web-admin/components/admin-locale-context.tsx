"use client";

import { createClientMessages } from "@publira/locale/client-messages";

import type { AdminClientMessages } from "#lib/messages";

/**
 * The request's locale and its catalog, as two reads, so the provider renders
 * in the static shell and only a component that needs one of them waits.
 */
const {
  ClientMessage,
  Provider,
  useClientLocale,
  useClientMessages: useAdminClientMessages,
} = createClientMessages<AdminClientMessages>(
  "AdminLocaleProvider is required."
);

export const AdminLocaleContextProvider = Provider;

/**
 * The console's UI locale in a Client Component.
 *
 * On the server this waits on the read under the boundary the surrounding
 * section already sits behind; the read has settled in the payload by the time
 * the browser hydrates, so it answers on the first client render. It does not
 * wait on the catalog.
 */
export const useAdminLocale = useClientLocale;

export { ClientMessage };

export const useClientMessages = useAdminClientMessages;
