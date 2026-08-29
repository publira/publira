import { DEFAULT_LOCALE } from "@publira/i18n";

import { getLocale, loadAdminMessages } from "./locale";
import type { AdminMessages } from "./locale";

/**
 * Resolve Server Action copy from the submitting tenant and UI locale.
 *
 * The raw form value only selects a tenant-default fallback locale. `getLocale`
 * validates it before it can reach the admin API; each Action still validates
 * the complete form independently before mutating data.
 */
export const getActionMessages = async (
  formData: FormData
): Promise<AdminMessages> => {
  const tenantId = formData.get("tenant_id");
  let locale = DEFAULT_LOCALE;
  try {
    locale = await getLocale(
      typeof tenantId === "string" ? tenantId : undefined
    );
  } catch {
    // Server Actions always have request storage. The fallback keeps direct
    // callers (for example isolated validation tests) deterministic as well.
  }

  return loadAdminMessages(locale);
};
