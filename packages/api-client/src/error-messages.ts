import { parseLocale } from "@publira/i18n";
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
 * specific to the operation ("この招待は再送できない状態です。"), and
 * `unexpected` is by definition unclassified. Both fall back to the caller's
 * operation-specific message unless overridden here.
 */
export type RpcErrorMessageOverrides = Partial<
  Record<RpcErrorDisposition, string>
>;

/**
 * The locale the shared wording falls back to when the caller names none.
 *
 * `@publira/i18n` no longer turns a missing or unknown value into a locale, so
 * this is the last place the previous behaviour of `options.locale` lives.
 *
 * Making `locale` required, and deleting this, is #1340.
 */
const FALLBACK_LOCALE: Locale = "ja";

export interface RpcErrorMessageOptions {
  /**
   * UI locale (`ja` | `en`). Unknown values fall back to `ja`.
   * Omit to keep the Japanese shared wording.
   */
  locale?: Locale | string;
  /** Replaces the shared wording for individual categories. */
  overrides?: RpcErrorMessageOverrides;
}

const isRpcErrorMessageOptions = (
  value: RpcErrorMessageOptions | RpcErrorMessageOverrides
): value is RpcErrorMessageOptions =>
  Object.hasOwn(value, "locale") || Object.hasOwn(value, "overrides");

const resolveRpcErrorMessageOptions = (
  overridesOrOptions?: RpcErrorMessageOptions | RpcErrorMessageOverrides
): RpcErrorMessageOptions | undefined => {
  if (!overridesOrOptions) {
    return undefined;
  }
  if (isRpcErrorMessageOptions(overridesOrOptions)) {
    return overridesOrOptions;
  }
  return { overrides: overridesOrOptions };
};

/**
 * Localized copy for a caught RPC error.
 *
 * Shared rather than per-app on purpose: the same RPC error has to read the
 * same way in `web-host`, `web-admin`, and `web-platform` (#645), in each
 * locale (#870).
 *
 * `fallback` is the operation-specific message ("著者の保存に失敗しました。…")
 * used when the category has no shared wording. Pass `overrides` to replace
 * the shared wording for individual categories. The third argument may also
 * be the overrides map itself, matching the pre-locale signature.
 */
export const rpcErrorMessage = (
  error: unknown,
  fallback: string,
  overridesOrOptions?: RpcErrorMessageOptions | RpcErrorMessageOverrides
): string => {
  const options = resolveRpcErrorMessageOptions(overridesOrOptions);
  const disposition = rpcErrorDisposition(error);

  return (
    options?.overrides?.[disposition] ??
    sharedRpcErrorMessage(
      disposition,
      parseLocale(options?.locale) ?? FALLBACK_LOCALE
    ) ??
    fallback
  );
};
