import type { ReactNode } from "react";

import { getLocale } from "#lib/locale";
import { loadHostClientMessages } from "#lib/messages";
import type { HostClientMessages } from "#lib/messages";

import { HostMessagesContextProvider } from "./host-messages-context";

const loadRequestMessages = async (): Promise<HostClientMessages> =>
  loadHostClientMessages(await getLocale());

/**
 * Carries the catalog of the request's locale to the Client Components below,
 * which read it through `<ClientMessage>` and `useClientMessages()`.
 *
 * The root layout places it, so `(site)`, `(auth)`, and the error boundary
 * beside them share one provider that survives navigation between them. It
 * takes no props and awaits nothing, so that layout still reads nothing: the
 * read starts here and is handed down unresolved.
 */
export const HostMessagesProvider = ({ children }: { children: ReactNode }) => (
  <HostMessagesContextProvider messages={loadRequestMessages()}>
    {children}
  </HostMessagesContextProvider>
);
