import type { Locale } from "@publira/i18n";
import { createLocaleMessagesProvider } from "@publira/locale/messages-provider";

import { loadStorefrontClientMessages } from "#lib/messages";
import type { StorefrontClientCatalog } from "#lib/messages";

import { StorefrontCatalogProvider } from "./storefront-messages-context";

const loadCatalog = async (
  locale: Locale
): Promise<StorefrontClientCatalog> => {
  const loaded = await loadStorefrontClientMessages(locale);

  return loaded.catalog;
};

/**
 * Carries the catalog of the request's locale to the Client Components below,
 * which read it through `<ClientMessage>` and `useClientMessages()`.
 *
 * The root layout places it, so `(site)`, `(auth)`, and the error boundary
 * beside them share one provider that survives navigation between them. It
 * takes no props and awaits nothing, so that layout still reads nothing: the
 * read starts here and is handed down unresolved.
 */
export const StorefrontMessagesProvider = createLocaleMessagesProvider(
  StorefrontCatalogProvider,
  loadCatalog
);
