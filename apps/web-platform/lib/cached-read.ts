/**
 * What a cached read hands its exported caller: the result, and whether its
 * failure is one no screen copy describes. A `"use cache"` scope must not
 * throw — the fill would fail the whole request — and an error that crosses
 * its boundary loses its `Code`, so the scope classifies the failure and the
 * caller, outside it, throws the unexpected ones.
 */
export type CachedRead<TResult> = TResult & { unexpected?: boolean };

/** The result of a cached read, thrown when its failure was unexpected. */
export const settleCachedRead = <
  TResult extends { ok: true } | { ok: false; message?: string },
>({
  unexpected,
  ...result
}: CachedRead<TResult>): TResult => {
  // SAFETY: `CachedRead` adds `unexpected` and nothing else to `TResult`, so
  // the rest left once it is taken out is the `TResult` it was built from.
  const settled = result as TResult;

  if (unexpected && !settled.ok) {
    throw new Error(settled.message);
  }

  return settled;
};
