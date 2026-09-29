import type { Locale } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { ReactNode } from "react";

import { AdminLocaleContextProvider } from "./admin-locale-context";

const fulfilled = <T,>(value: T): Promise<T> =>
  Object.assign(Promise.resolve(value), { status: "fulfilled", value });

/**
 * What `AdminLocaleProvider` hands a Client Component, for a test that renders
 * one on its own.
 *
 * Both reads are passed as promises React already knows are fulfilled, which is
 * what the RSC payload gives the browser: `use()` then answers on the first
 * render, so a test does not have to wait for a boundary to settle.
 */
export const AdminLocaleTestProvider = ({
  children,
  locale,
}: {
  children: ReactNode;
  locale: Locale;
}) => (
  <AdminLocaleContextProvider
    locale={fulfilled(locale)}
    messages={fulfilled(sharedCatalog(locale))}
  >
    {children}
  </AdminLocaleContextProvider>
);
