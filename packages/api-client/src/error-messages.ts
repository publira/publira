import type { Locale } from "@publira/i18n";
import { sharedRpcErrorMessage } from "@publira/i18n/catalog";

import type { RpcErrorDisposition } from "./errors.js";
import { rpcErrorDisposition } from "./errors.js";

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
