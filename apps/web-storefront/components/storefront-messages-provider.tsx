import type { ReactNode } from "react";

import { getLocale } from "#lib/locale";
import { loadStorefrontClientMessages } from "#lib/messages";
import type { StorefrontClientMessages } from "#lib/messages";

import { StorefrontMessagesContextProvider } from "./storefront-messages-context";

const loadRequestMessages = async (): Promise<StorefrontClientMessages> =>
  loadStorefrontClientMessages(await getLocale());

/**
 * Carries the catalog of the request's locale to the Client Components below,
 * which read it through `<ClientMessage>` and `useClientMessages()`.
 *
 * The root layout places it, so `(site)`, `(auth)`, and the error boundary
 * beside them share one provider that survives navigation between them. It
 * takes no props and awaits nothing, so that layout still reads nothing: the
 * read starts here and is handed down unresolved.
 */
export const StorefrontMessagesProvider = ({
  children,
}: {
  children: ReactNode;
}) => (
  <StorefrontMessagesContextProvider messages={loadRequestMessages()}>
    {children}
  </StorefrontMessagesContextProvider>
);
