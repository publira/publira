import type { ReactNode } from "react";

import { getPlatformLocale } from "#lib/locale";
import { loadPlatformClientMessages } from "#lib/messages";
import type { PlatformClientMessages } from "#lib/messages";

import { PlatformMessagesContextProvider } from "./platform-messages-context";

const loadRequestMessages = async (): Promise<PlatformClientMessages> =>
  loadPlatformClientMessages(await getPlatformLocale());

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
export const PlatformMessagesProvider = ({
  children,
}: {
  children: ReactNode;
}) => (
  <PlatformMessagesContextProvider messages={loadRequestMessages()}>
    {children}
  </PlatformMessagesContextProvider>
);
