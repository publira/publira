import type { Locale } from "@publira/i18n";

import { getLocale } from "./locale";
import { getMessagesFor } from "./messages";
import type { AdminMessageAccessor } from "./messages";

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
 * and binds the accessor from it with `getMessagesFor`.
 *
 * This is the Action-side counterpart of `getMessages()`, and it answers the
 * same accessor: `next/root-params` is what the two differ in, not the shape of
 * what comes back.
 */
export const getActionMessages = async (
  formData: FormData
): Promise<AdminMessageAccessor> => {
  const locale = await getActionLocale(formData);

  return getMessagesFor(locale);
};
