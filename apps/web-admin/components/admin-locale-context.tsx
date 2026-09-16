"use client";

import type { Locale } from "@publira/i18n";
import { createContext } from "react";
import type { ReactNode } from "react";

import type { AdminMessages } from "#lib/messages";

/** The protected layout supplies the request's cookie-or-tenant locale. */
export const AdminLocaleContext = createContext<Locale | null>(null);

/**
 * The catalog of that same locale, resolved on the server, so a Client
 * Component's copy is there on its first render instead of arriving after
 * hydration.
 */
export const AdminMessagesContext = createContext<AdminMessages | null>(null);

export const AdminLocaleProvider = ({
  children,
  locale,
  messages,
}: {
  children: ReactNode;
  locale: Locale;
  messages: AdminMessages;
}) => (
  <AdminLocaleContext value={locale}>
    <AdminMessagesContext value={messages}>{children}</AdminMessagesContext>
  </AdminLocaleContext>
);
