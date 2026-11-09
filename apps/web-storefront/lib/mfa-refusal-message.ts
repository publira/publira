import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rpcErrorDisposition,
  rpcErrorHasFieldViolation,
} from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";

import type {
  StorefrontMessageAccessor,
  StorefrontMessageKey,
} from "./messages";
import type { MfaChangeOutcome } from "./mfa";
import type { MfaCodeRefusal } from "./mfa-shared";

/**
 * Which codes a field takes: one from the authenticator app alone, where the
 * point is proving the authenticator; a recovery code alone, on the code
 * step's recovery form; or either, where the point is proving the account.
 */
export type MfaCodeAccepts =
  | "authenticator"
  | "authenticator_or_recovery"
  | "recovery";

const INVALID_CODE_MESSAGES = {
  authenticator: "storefront.auth.two_step.errors.invalid_code",
  authenticator_or_recovery:
    "storefront.auth.two_step.errors.invalid_code_or_recovery_code",
  recovery: "storefront.auth.two_step.errors.invalid_recovery_code",
} as const satisfies Record<MfaCodeAccepts, StorefrontMessageKey>;

/**
 * The wording of a code the API refused, for the kind of code the field asked
 * for: the code step and the forms under **Security** all say the same.
 */
export const mfaRefusalMessage = (
  t: StorefrontMessageAccessor,
  refusal: MfaCodeRefusal,
  accepts: MfaCodeAccepts
): string => {
  switch (refusal) {
    case "locked": {
      return t("storefront.auth.two_step.errors.locked");
    }

    case "rate_limited": {
      return t("errors.rpc.rate-limited");
    }

    case "invalid_code": {
      return t(INVALID_CODE_MESSAGES[accepts]);
    }

    default: {
      return refusal satisfies never;
    }
  }
};

/**
 * The wording of a refused attempt to turn two-step verification off. A wrong
 * password is `invalid_argument` on `password`. A fresh sign-in is spent
 * before the code is checked, so a refused one asks for another; the code
 * field takes a recovery code too, so a wrong code is worded for either.
 */
export const mfaDisableRefusalMessage = (
  t: StorefrontMessageAccessor,
  locale: Locale,
  refusal: Extract<MfaChangeOutcome, { ok: false }>,
  confirmedWith: "fresh_sign_in" | "password"
): string => {
  if ("code" in refusal) {
    return mfaRefusalMessage(t, refusal.code, "authenticator_or_recovery");
  }

  if (
    confirmedWith === "password" &&
    rpcErrorDisposition(refusal.error) === "invalid-argument" &&
    rpcErrorHasFieldViolation(refusal.error, "password")
  ) {
    return t("storefront.settings.mfa_disable_wrong_password");
  }

  return rpcErrorMessage(
    refusal.error,
    t("storefront.settings.mfa_disable_failed"),
    {
      locale,
      overrides:
        confirmedWith === "password"
          ? undefined
          : {
              "invalid-argument": t(
                "storefront.settings.mfa_disable_unconfirmed"
              ),
            },
    }
  );
};
