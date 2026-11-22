import type { Locale } from "@publira/i18n";
import { createLocaleMessagesProvider } from "@publira/locale/messages-provider";

import { loadPlatformClientMessages } from "#lib/messages";
import type { PlatformClientCatalog } from "#lib/messages";

import { PlatformCatalogProvider } from "./platform-messages-context";

const loadCatalog = async (locale: Locale): Promise<PlatformClientCatalog> => {
  const loaded = await loadPlatformClientMessages(locale);

  return loaded.catalog;
};

/**
 * Carries the catalog of the request's locale to the Client Components below,
 * which read it through `<ClientMessage>` and `useClientMessages()`.
 *
 * The root layout places it, so every route — the sign-in and setup screens
 * included — has it. It takes no props and awaits nothing, so that layout still
 * settles nothing before its children: the read starts here and is handed down
 * unresolved, and the wait lands on the component that names a string rather
 * than on every route.
 */
export const PlatformMessagesProvider = createLocaleMessagesProvider(
  PlatformCatalogProvider,
  loadCatalog
);
