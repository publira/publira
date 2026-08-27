import { rpcErrorMessage } from "@publira/api-client/error-messages";
import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { cachedReadFailure } from "@publira/utils/cached-read";
import type { CachedReadResult } from "@publira/utils/cached-read";

import { loadHostMessages } from "./messages";
import type { HostMessageKey } from "./messages";

/**
 * The failure half of a cached read, worded in the reader's language.
 *
 * `key` names the operation-specific sentence — the fallback for the categories
 * `rpcErrorMessage` has no shared copy for — and `locale` is what the reader is
 * on. Every read that calls this takes the locale as an argument rather than
 * resolving it inside the `"use cache"` scope, so the language is part of the
 * cache key instead of being baked into whichever request filled the entry.
 */
export const localizedReadFailure = async <TValue = never>(
  error: unknown,
  locale: Locale,
  key: HostMessageKey
): Promise<CachedReadResult<TValue>> => {
  const messages = await loadHostMessages(locale);

  return cachedReadFailure<TValue>(
    rpcErrorMessage(error, getMessage(messages, key), { locale })
  );
};
