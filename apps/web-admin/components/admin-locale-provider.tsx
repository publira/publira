import { createLocaleMessagesProvider } from "@publira/locale/messages-provider";

import { loadAdminClientMessages } from "#lib/messages";

import { AdminLocaleContextProvider } from "./admin-locale-context";

/**
 * Carries the request's locale and its catalog to the Client Components below,
 * which read them through `useAdminLocale()`, `<ClientMessage>`, and
 * `useClientMessages()`.
 *
 * The root layout places it, so every route — sign-in, account recovery, and
 * MFA included — has it. It takes no props and awaits nothing, so that layout
 * still settles nothing before its children: the reads start here and are
 * handed down unresolved, and the wait lands on the component that needs them
 * rather than on every route.
 */
export const AdminLocaleProvider = createLocaleMessagesProvider(
  AdminLocaleContextProvider,
  loadAdminClientMessages
);
