import type { Locale } from "@publira/i18n";
import type { ReactNode } from "react";

import { getLocale } from "#lib/locale";
import { loadAdminClientMessages } from "#lib/messages";
import type { AdminClientMessages } from "#lib/messages";

import { AdminLocaleContextProvider } from "./admin-locale-context";

const readRequestMessages = async (
  locale: Promise<Locale>
): Promise<AdminClientMessages> => loadAdminClientMessages(await locale);

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
export const AdminLocaleProvider = ({ children }: { children: ReactNode }) => {
  const locale = getLocale();

  return (
    <AdminLocaleContextProvider
      locale={locale}
      messages={readRequestMessages(locale)}
    >
      {children}
    </AdminLocaleContextProvider>
  );
};
