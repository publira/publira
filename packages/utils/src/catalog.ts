/**
 * Synchronous lookup into the repo-root message catalog.
 *
 * `rpcErrorMessage` and the form helpers run inside `catch` / `safeParse` and
 * must stay sync, so both locales are imported statically. Per-route UI
 * catalogs still load through `loadMessages` so unused locales stay out of a
 * chunk.
 */

import en from "../../../locales/en.json" with { type: "json" };
import ja from "../../../locales/ja.json" with { type: "json" };
import { getMessage, parseLocale } from "./i18n";
import type { Locale, MessageKey } from "./i18n";

export type SharedMessages = typeof ja;

const CATALOGS = {
  en,
  ja,
} as const satisfies Record<Locale, SharedMessages>;

const RPC_MESSAGE_KEYS = {
  conflict: "errors.rpc.conflict",
  forbidden: "errors.rpc.forbidden",
  "invalid-argument": "errors.rpc.invalid-argument",
  "not-found": "errors.rpc.not-found",
  unauthenticated: "errors.rpc.unauthenticated",
  unavailable: "errors.rpc.unavailable",
} as const satisfies Record<string, MessageKey<SharedMessages>>;

export type SharedRpcDisposition = keyof typeof RPC_MESSAGE_KEYS;

/** The catalog for `locale`. Unknown values fall back to `ja`. */
export const sharedCatalog = (locale?: Locale | string): SharedMessages =>
  CATALOGS[parseLocale(locale)];

export const sharedMessage = (
  key: MessageKey<SharedMessages> | string,
  locale?: Locale | string
): string => getMessage(sharedCatalog(locale), key);

/**
 * Shared wording for one RPC failure category, or `undefined` when that
 * category has no shared copy (`precondition` / `unexpected`).
 */
export const sharedRpcErrorMessage = (
  disposition: SharedRpcDisposition | string,
  locale?: Locale | string
): string | undefined => {
  if (!Object.hasOwn(RPC_MESSAGE_KEYS, disposition)) {
    return undefined;
  }

  return sharedMessage(
    RPC_MESSAGE_KEYS[disposition as SharedRpcDisposition],
    locale
  );
};
