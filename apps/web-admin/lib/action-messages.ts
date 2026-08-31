import type { Locale } from "@publira/i18n";

import { FALLBACK_LOCALE } from "./fallback-locale";
import { getLocale, loadAdminMessages } from "./locale";
import type { AdminMessages } from "./locale";

/**
 * The UI locale a Server Action's response should be worded in.
 *
 * The raw form value only selects a tenant-default fallback locale. `getLocale`
 * validates it before it can reach the admin API; each Action still validates
 * the complete form independently before mutating data.
 */
export const getActionLocale = async (formData: FormData): Promise<Locale> => {
  const tenantId = formData.get("tenant_id");
  try {
    return await getLocale(typeof tenantId === "string" ? tenantId : undefined);
  } catch {
    // Server Actions always have request storage. The fallback keeps direct
    // callers (for example isolated validation tests) deterministic as well.
    return FALLBACK_LOCALE;
  }
};

/**
 * Shorthand for an Action whose only use of the locale is its own copy. An
 * Action that also hands the locale to `lib/` — so the wording of an RPC
 * failure follows the operator's language too — calls {@link getActionLocale}
 * and resolves the catalog from it.
 */
export const getActionMessages = async (
  formData: FormData
): Promise<AdminMessages> => loadAdminMessages(await getActionLocale(formData));
