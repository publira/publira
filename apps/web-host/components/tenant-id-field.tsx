"use client";

import { useTenantId } from "#lib/use-tenant-id";

/**
 * Hidden field that carries the tenant id into a Server Action.
 *
 * Actions cannot read `next/root-params`, so every form that calls one passes
 * the tenant id the way it passes the locale — a hidden field. Rendering it as
 * its own client component is what lets the form around it be a Server
 * Component: the labels then resolve from the catalog on the server, each in
 * its own `<Suspense>`, instead of the whole card becoming client-side.
 *
 * The companion for the locale is `<LocaleField>`.
 */
export const TenantIdField = () => {
  const tenantId = useTenantId();

  return <input name="tenantId" type="hidden" value={tenantId} />;
};
