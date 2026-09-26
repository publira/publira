"use client";

import type { Locale } from "@publira/i18n";
import { createContext, use } from "react";
import type { ReactNode } from "react";

import type { AdminClientMessages } from "#lib/messages";

/**
 * The request's cookie-or-tenant locale as the read that resolves it, so the
 * provider renders in the static shell and only a component that needs the
 * locale waits.
 */
export const AdminLocaleContext = createContext<Promise<Locale> | null>(null);

/**
 * The catalog of that same locale, read on the server, so a Client Component's
 * copy is there on its first render instead of arriving after hydration.
 */
export const AdminMessagesContext =
  createContext<Promise<AdminClientMessages> | null>(null);

export const AdminLocaleContextProvider = ({
  children,
  locale,
  messages,
}: {
  children: ReactNode;
  locale: Promise<Locale>;
  messages: Promise<AdminClientMessages>;
}) => (
  <AdminLocaleContext value={locale}>
    <AdminMessagesContext value={messages}>{children}</AdminMessagesContext>
  </AdminLocaleContext>
);

/**
 * The console's UI locale in a Client Component.
 *
 * On the server this waits on the read under the boundary the surrounding
 * section already sits behind; the read has settled in the payload by the time
 * the browser hydrates, so it answers on the first client render.
 */
export const useAdminLocale = (): Locale => {
  const locale = use(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }

  return use(locale);
};
