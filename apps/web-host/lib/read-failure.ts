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

/**
 * The same failure, for a read that has no error to classify.
 *
 * A cursor walk that runs out of its page or row budget answers with every row
 * it managed to read and no exception, and a caller that took that for the
 * whole list would show a truncated one — or, worse, conclude that the record
 * it was looking for does not exist. Such a read reports the operation's own
 * sentence, the one {@link localizedReadFailure} falls back to, because what
 * the reader can do about it is the same either way.
 */
export const localizedReadUnavailable = async <TValue = never>(
  locale: Locale,
  key: HostMessageKey
): Promise<CachedReadResult<TValue>> => {
  const messages = await loadHostMessages(locale);

  return cachedReadFailure<TValue>(getMessage(messages, key));
};
