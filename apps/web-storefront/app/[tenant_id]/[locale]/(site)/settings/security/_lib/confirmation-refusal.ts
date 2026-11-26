import { rpcErrorMessage } from "@publira/api-client/error-messages";
import type { RpcErrorDisposition } from "@publira/api-client/errors";
import {
  rpcErrorDisposition,
  rpcErrorHasFieldViolation,
} from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";

import type { AccountConfirmation } from "#lib/auth";
import type { StorefrontMessageAccessor } from "#lib/messages";

/**
 * The words for a refused step that confirmed the account first: adding or
 * removing a passkey, or unlinking a provider. The API answers a confirmation
 * that does not verify with `invalid_argument` on the field it came in, so
 * that is worded for the confirmation the reader gave, and any other refusal
 * as the step words it.
 */
export const confirmationRefusalMessage = (
  t: StorefrontMessageAccessor,
  locale: Locale,
  { error }: { error: unknown; ok: false },
  confirmation: AccountConfirmation,
  fallback: string,
  overrides?: Partial<Record<RpcErrorDisposition, string>>
): string => {
  if (rpcErrorDisposition(error) === "invalid-argument") {
    if ("password" in confirmation) {
      if (rpcErrorHasFieldViolation(error, "password")) {
        return t("storefront.settings.confirm_wrong_password");
      }
    } else if ("passkeyCredential" in confirmation) {
      return t("storefront.settings.passkey_confirm_failed");
    } else {
      return t("storefront.settings.confirm_unconfirmed");
    }
  }

  return rpcErrorMessage(error, fallback, { locale, overrides });
};
