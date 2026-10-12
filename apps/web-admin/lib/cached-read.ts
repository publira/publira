import type { Code } from "@publira/api-client/errors";
import {
  ConnectError,
  rpcErrorCode,
  rpcErrorRawMessage,
} from "@publira/api-client/errors";

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
  const settled = result as TResult;
  if (unexpected && !settled.ok) {
    throw new Error(settled.message);
  }
  return settled;
};

/**
 * The error a cached read caught, as data that survives the cache boundary.
 *
 * For a read whose caller throws more than the failures no screen copy
 * describes — an unreachable API included — so that the error screen and the
 * server log name what failed rather than which read did. The `Error` itself
 * cannot cross: React Flight re-creates it without its `Code` or its message.
 */
export interface CaughtReadError {
  code: Code | null;
  message: string;
}

export const toCaughtReadError = (error: unknown): CaughtReadError => {
  const code = rpcErrorCode(error);
  if (code !== null) {
    return { code, message: rpcErrorRawMessage(error) ?? "" };
  }
  return {
    code: null,
    message: error instanceof Error ? error.message : String(error),
  };
};

/** The error {@link toCaughtReadError} described, rebuilt to be thrown. */
export const rebuildCaughtReadError = ({
  code,
  message,
}: CaughtReadError): Error =>
  code === null ? new Error(message) : new ConnectError(message, code);
