import { defaultLocaleLangScript } from "@publira/i18n";
import { tenant_id } from "next/root-params";

import { findTenantDisplayLocale } from "#lib/public-api";
import { isTenantIdFormat } from "#lib/tenant-id-format";

/**
 * Puts the tenant's stored default locale into `<html lang>`.
 *
 * The root layout cannot do it: naming the tenant's language needs a read, and
 * a root layout that awaits blocks the whole tree for an attribute. So the
 * value arrives as a script from here, under a `<Suspense>` the caller places,
 * and the document is served without waiting for it.
 *
 * The script does not overwrite a language already on the element, so an
 * operator who has chosen one keeps it: `LOCALE_LANG_SCRIPT` applies their
 * cookie while the document is still being parsed, whichever script the browser
 * reaches first.
 *
 * A segment that is not a tenant never went through `proxy.ts` and has no
 * stored default to read; a tenant whose read fails has one that cannot be
 * reached. Neither writes an attribute — a `lang` the document is not written
 * in tells a screen reader to pronounce the page in the wrong language, which
 * is worse for that reader than an absent one.
 */
export const TenantLangScript = async () => {
  const tenantId = await tenant_id();
  const normalizedTenantId =
    typeof tenantId === "string" ? tenantId.trim() : "";
  if (!isTenantIdFormat(normalizedTenantId)) {
    return null;
  }

  const defaultLocale = await findTenantDisplayLocale(normalizedTenantId);
  if (!defaultLocale) {
    return null;
  }

  return (
    <script
      dangerouslySetInnerHTML={{
        __html: defaultLocaleLangScript(defaultLocale),
      }}
    />
  );
};
