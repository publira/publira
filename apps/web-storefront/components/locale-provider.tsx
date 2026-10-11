import type { ReactNode } from "react";

import { getLocale, tenantDefaultLocale } from "#lib/locale";

import {
  LocaleContextProvider,
  TenantDefaultLocaleContextProvider,
} from "./locale-context";

/** Hands the request's locale to `useLocale()` without awaiting it. */
export const LocaleProvider = ({ children }: { children: ReactNode }) => (
  <LocaleContextProvider locale={getLocale()}>{children}</LocaleContextProvider>
);

/**
 * Hands the tenant's stored default to `useTenantDefaultLocale()` without
 * awaiting it, since one static shell is shared by every tenant.
 */
export const TenantDefaultLocaleProvider = ({
  children,
}: {
  children: ReactNode;
}) => (
  <TenantDefaultLocaleContextProvider defaultLocale={tenantDefaultLocale()}>
    {children}
  </TenantDefaultLocaleContextProvider>
);
