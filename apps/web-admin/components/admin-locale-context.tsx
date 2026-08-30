"use client";

import type { Locale } from "@publira/i18n";
import { createContext } from "react";
import type { ReactNode } from "react";

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
