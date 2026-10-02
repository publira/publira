import type { Locale } from "@publira/i18n";

import { verifyAdminSession } from "./auth-session";
import { getLocale } from "./locale";
import { getTenantId } from "./tenant-id";

/** The tenant a Server Component renders for, and the language it renders in. */
export interface AdminPageSession {
  locale: Locale;
  tenantId: string;
}

/**
 * The tenant and locale of the console screen being rendered, once the signed-in
 * operator has been confirmed for it.
 *
 * What the shared reads called from a Server Component resolve before their
 * cached body, so the screen passes them nothing: the tenant comes from the
 * `[tenant_id]` segment and the locale from the operator's choice, the same
 * values the screen itself renders with. A Server Action cannot read that
 * segment: it confirms the operator for the tenant it was given with
 * `verifyAdminSession` and calls the cached `*ForTenant` body itself.
 */
export const verifyAdminPageSession = async (): Promise<AdminPageSession> => {
  const tenantId = await getTenantId();
  // The operator first: with no locale cookie, the locale is a read that can
  // fail, and failing before a rejected session settled would bring up the
  // error screen instead of the login redirect.
  await verifyAdminSession(tenantId);
  return { locale: await getLocale(tenantId), tenantId };
};
