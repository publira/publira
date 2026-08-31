import type { Locale } from "@publira/i18n";

import { getLocale, loadAdminMessages } from "./locale";
import type { AdminMessages } from "./locale";

/**
 * The UI locale a Server Action's response should be worded in.
 *
 * `next/root-params` is unavailable in a Server Action, so the tenant id
 * travels in the form. `getLocale` validates it before it reaches any API;
 * each Action still validates the complete form independently before mutating
 * data.
 *
 * A submission with no tenant id did not come from a console screen, and an
 * Action that cannot name the operator's language has none to answer in, so
 * both throw rather than picking one.
 */
export const getActionLocale = (formData: FormData): Promise<Locale> => {
  const tenantId = formData.get("tenant_id");
  if (typeof tenantId !== "string") {
    throw new TypeError("tenant_id is missing from the submitted form");
  }

  return getLocale(tenantId);
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
