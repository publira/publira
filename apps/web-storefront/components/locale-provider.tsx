import type { ReactNode } from "react";

import {
  getLocale,
  tenantDefaultLocale,
  tenantSupportedLocales,
} from "#lib/locale";

import {
  LocaleContextProvider,
  TenantLocalesContextProvider,
} from "./locale-context";

/** Hands the request's locale to `useLocale()` without awaiting it. */
export const LocaleProvider = ({ children }: { children: ReactNode }) => (
  <LocaleContextProvider locale={getLocale()}>{children}</LocaleContextProvider>
);

/**
 * Hands the tenant's stored default to `useTenantDefaultLocale()`, and the
 * locales it offers to `useTenantSupportedLocales()`, without awaiting either,
 * since one static shell is shared by every tenant.
 */
export const TenantLocalesProvider = ({
  children,
}: {
  children: ReactNode;
}) => (
  <TenantLocalesContextProvider
    defaultLocale={tenantDefaultLocale()}
    supportedLocales={tenantSupportedLocales()}
  >
    {children}
  </TenantLocalesContextProvider>
);
