import type { Locale } from "@publira/i18n";
import type { ReactNode } from "react";

import { getLocale } from "#lib/locale";
import { loadAdminClientMessages } from "#lib/messages";
import type { AdminClientMessages } from "#lib/messages";
import { getTenantId } from "#lib/tenant-id";

import { AdminLocaleContextProvider } from "./admin-locale-context";

const readRequestLocale = async (): Promise<Locale> =>
  getLocale(await getTenantId());

const readRequestMessages = async (
  locale: Promise<Locale>
): Promise<AdminClientMessages> => loadAdminClientMessages(await locale);

/**
 * Carries the request's locale and its catalog to the Client Components below,
 * which read them through `useAdminLocale()`, `<ClientMessage>`, and
 * `useClientMessages()`.
 *
 * It takes no props and awaits nothing, so the layout that places it settles
 * nothing before its children: the reads start here and are handed down
 * unresolved, and the wait lands on the component that needs them rather than
 * on every console route.
 */
export const AdminLocaleProvider = ({ children }: { children: ReactNode }) => {
  const locale = readRequestLocale();

  return (
    <AdminLocaleContextProvider
      locale={locale}
      messages={readRequestMessages(locale)}
    >
      {children}
    </AdminLocaleContextProvider>
  );
};
