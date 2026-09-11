import type { Locale } from "@publira/i18n";
import { sharedMessage, sharedRpcErrorMessage } from "@publira/i18n/catalog";

import type { RpcErrorDisposition } from "./errors.js";
import {
  RPC_ERROR_REASON,
  rpcErrorDisposition,
  rpcErrorHasReason,
} from "./errors.js";

const smtpTestFailureReasons = [
  RPC_ERROR_REASON.smtpTestAuthentication,
  RPC_ERROR_REASON.smtpTestConnection,
  RPC_ERROR_REASON.smtpTestRecipient,
  RPC_ERROR_REASON.smtpTestStartTLS,
  RPC_ERROR_REASON.smtpTestTLS,
  RPC_ERROR_REASON.smtpTestTimeout,
  RPC_ERROR_REASON.smtpTestUnknown,
] as const;

const smtpTestFailureMessageKeys = {
  [RPC_ERROR_REASON.smtpTestAuthentication]: "errors.smtp_test.authentication",
  [RPC_ERROR_REASON.smtpTestConnection]: "errors.smtp_test.connection",
  [RPC_ERROR_REASON.smtpTestRecipient]: "errors.smtp_test.recipient",
  [RPC_ERROR_REASON.smtpTestStartTLS]: "errors.smtp_test.starttls",
  [RPC_ERROR_REASON.smtpTestTLS]: "errors.smtp_test.tls",
  [RPC_ERROR_REASON.smtpTestTimeout]: "errors.smtp_test.timeout",
  [RPC_ERROR_REASON.smtpTestUnknown]: "errors.smtp_test.unknown",
} as const;

type SmtpTestFailureReason = keyof typeof smtpTestFailureMessageKeys;

/** Returns localized SMTP test failure copy for a server-stored reason code. */
export const smtpTestFailureMessage = (
  reason: string,
  locale: Locale
): string | undefined => {
  if (!Object.hasOwn(smtpTestFailureMessageKeys, reason)) {
    return undefined;
  }

  return sharedMessage(
    smtpTestFailureMessageKeys[reason as SmtpTestFailureReason],
    locale
  );
};

/** Returns localized SMTP test failure copy from a Connect ErrorInfo detail. */
export const smtpTestFailureErrorMessage = (
  error: unknown,
  locale: Locale
): string | undefined => {
  for (const reason of smtpTestFailureReasons) {
    if (rpcErrorHasReason(error, reason)) {
      return smtpTestFailureMessage(reason, locale);
    }
  }
  return undefined;
};

/**
 * Per-category replacements for the shared RPC wording.
 *
 * A screen that needs different wording passes an override for that one
 * category instead of re-deriving the category itself. `precondition` and
 * `unexpected` have no shared copy — what a failed precondition means is
 * specific to the operation ("This invitation cannot be resent."), and
 * `unexpected` is by definition unclassified. Both fall back to the caller's
 * operation-specific message unless overridden here.
 */
export type RpcErrorMessageOverrides = Partial<
  Record<RpcErrorDisposition, string>
>;

export interface RpcErrorMessageOptions {
  /** UI locale the shared wording is read in. */
  locale: Locale;
  /** Replaces the shared wording for individual categories. */
  overrides?: RpcErrorMessageOverrides;
}

/**
 * Localized copy for a caught RPC error.
 *
 * Shared rather than per-app on purpose: the same RPC error has to read the
 * same way in `web-host`, `web-admin`, and `web-platform`, in each locale.
 *
 * `fallback` is the operation-specific message ("Could not save the creator. …")
 * used when the category has no shared wording. Pass `overrides` to replace
 * the shared wording for individual categories.
 *
 * `locale` is required. A caller that cannot name one cannot word `fallback`
 * either, so it has a locale to resolve before it has an error to report.
 */
export const rpcErrorMessage = (
  error: unknown,
  fallback: string,
  options: RpcErrorMessageOptions
): string => {
  const disposition = rpcErrorDisposition(error);

  return (
    options.overrides?.[disposition] ??
    sharedRpcErrorMessage(disposition, options.locale) ??
    fallback
  );
};
