"use client";

import { bindMessages } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { createContext, useContext } from "react";
import type { ReactNode } from "react";

import type { AdminMessageAccessor } from "#lib/messages";

/** The protected layout supplies the request's cookie-or-tenant locale. */
export const AdminLocaleContext = createContext<Locale | null>(null);

export const AdminLocaleProvider = ({
  children,
  locale,
}: {
  children: ReactNode;
  locale: Locale;
}) => (
  <AdminLocaleContext.Provider value={locale}>
    {children}
  </AdminLocaleContext.Provider>
);

/**
 * The accessor a Client Component reads its copy through.
 *
 * `<Message>` is an async Server Component, so a Client Component resolves
 * strings itself, and it has no locale of its own to resolve them in — a
 * component rendered outside a provider would answer in whatever language the
 * default happened to be, which is the failure `getLocale()` refuses to make
 * on the server. Missing the provider is therefore a wiring bug, not a case to
 * fall back from.
 *
 * The shared catalog is bound here rather than loaded: a hook cannot await, and
 * this one is imported statically for exactly that reason.
 */
export const useAdminMessages = (): AdminMessageAccessor => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }

  return bindMessages(sharedCatalog(locale));
};
