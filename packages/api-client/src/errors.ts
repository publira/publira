import {
  BadRequestSchema,
  ErrorInfoSchema,
} from "@buf/googleapis_googleapis.bufbuild_es/google/rpc/error_details_pb";
import { Code, ConnectError } from "@connectrpc/connect";

export { Code, ConnectError } from "@connectrpc/connect";

/** Stable reasons attached by Publira APIs through `google.rpc.ErrorInfo`. */
export const RPC_ERROR_REASON = {
  archiveInvalidEPUB: "ARCHIVE_INVALID_EPUB",
  archiveInvalidEPUBSpine: "ARCHIVE_INVALID_EPUB_SPINE",
  archiveInvalidPath: "ARCHIVE_INVALID_PATH",
  invitationCanceled: "INVITATION_CANCELED",
  mfaInvalidCode: "MFA_INVALID_CODE",
  mfaLocked: "MFA_LOCKED",
} as const;

export type RpcErrorReason =
  (typeof RPC_ERROR_REASON)[keyof typeof RPC_ERROR_REASON];

const RPC_ERROR_INFO_DOMAIN = "publira";

/**
 * How a caught RPC failure should be handled.
 *
 * One entry per group of `Code`s that the UI treats identically, so a call site
 * never has to know the whole `Code` enum. Every code maps to exactly one
 * disposition, and anything that is not an RPC error maps to `"unexpected"` —
 * which always means "this is a real failure, let it reach the error boundary".
 */
export type RpcErrorDisposition =
  | "conflict"
  | "forbidden"
  | "invalid-argument"
  | "not-found"
  | "precondition"
  | "unauthenticated"
  | "unavailable"
  | "unexpected";

const DISPOSITION_BY_CODE: Readonly<Record<Code, RpcErrorDisposition>> = {
  [Code.Aborted]: "conflict",
  [Code.AlreadyExists]: "conflict",
  [Code.Canceled]: "unavailable",
  [Code.DataLoss]: "unexpected",
  [Code.DeadlineExceeded]: "unavailable",
  [Code.FailedPrecondition]: "precondition",
  [Code.Internal]: "unexpected",
  [Code.InvalidArgument]: "invalid-argument",
  [Code.NotFound]: "not-found",
  [Code.OutOfRange]: "invalid-argument",
  [Code.PermissionDenied]: "forbidden",
  [Code.ResourceExhausted]: "unavailable",
  [Code.Unauthenticated]: "unauthenticated",
  [Code.Unavailable]: "unavailable",
  [Code.Unimplemented]: "unexpected",
  [Code.Unknown]: "unexpected",
};

/** `NotFound` → `not_found`, matching Connect's own wire spelling. */
const toWireName = (name: string): string =>
  name.charAt(0).toLowerCase() +
  name
    .slice(1)
    .replaceAll(/[A-Z]/gu, (character) => `_${character.toLowerCase()}`);

const buildCodeByWireName = (): ReadonlyMap<string, Code> => {
  const byWireName = new Map<string, Code>();
  for (const value of Object.values(Code)) {
    if (typeof value === "number") {
      byWireName.set(toWireName(Code[value]), value);
    }
  }
  return byWireName;
};

let codeByWireName: ReadonlyMap<string, Code> | undefined;

/**
 * Connect prefixes every error message with its own code, e.g.
 * `[not_found] series not found`. This reads that prefix back.
 */
const codeFromMessagePrefix = (message: string): Code | null => {
  const match = /^\[(?<wireName>[a-z_]+)\]/u.exec(message);
  const wireName = match?.groups?.wireName;
  if (!wireName) {
    return null;
  }

  codeByWireName ??= buildCodeByWireName();
  return codeByWireName.get(wireName) ?? null;
};

/**
 * An error that crossed a serialization boundary: Next.js re-creates errors
 * thrown inside a `"use cache"` scope from `name` and `message` only, so `code`
 * and `rawMessage` are gone and `instanceof ConnectError` no longer holds.
 *
 * The name is required, not merely the message shape. Without it any
 * `new Error("[not_found] …")` would classify as an RPC failure and stop
 * `rethrowUnclassifiedRpcError()` from doing its job.
 */
const isRehydratedConnectError = (error: unknown): error is Error =>
  error instanceof Error && error.name === "ConnectError";

/**
 * The Connect `Code` behind a caught value, or `null` when it is not an RPC
 * error at all.
 *
 * `ConnectError` implements `Symbol.hasInstance`, so `instanceof` already works
 * across realms and duplicated module instances; the rehydrated case falls back
 * to Connect's own `[not_found]` message prefix. This function is the one place
 * in the repository that reads that prefix — call sites classify by `Code` and
 * never by message text.
 */
export const rpcErrorCode = (error: unknown): Code | null => {
  if (error instanceof ConnectError) {
    return error.code;
  }
  if (isRehydratedConnectError(error)) {
    return codeFromMessagePrefix(error.message);
  }
  return null;
};

/** Whether `error` is an RPC error carrying one of `codes`. */
export const isRpcError = (
  error: unknown,
  ...codes: readonly [Code, ...Code[]]
): boolean => {
  const code = rpcErrorCode(error);
  return code !== null && codes.includes(code);
};

/** The handling category for a caught value. Non-RPC errors are `"unexpected"`. */
export const rpcErrorDisposition = (error: unknown): RpcErrorDisposition => {
  const code = rpcErrorCode(error);
  return code === null ? "unexpected" : DISPOSITION_BY_CODE[code];
};

/**
 * "There is nothing to show here": the record does not exist, or the caller may
 * not see it.
 *
 * The two are deliberately not distinguished. A public surface that rendered
 * `permission_denied` differently from `not_found` would leak whether the
 * record exists, and the server already returns `permission_denied` for another
 * tenant's rows and for unpublished content.
 *
 * Callers turn this into `notFound()`, or into `null` when they run inside a
 * `"use cache"` scope where a throw is not observable by the caller.
 */
export const isMissingResourceRpcError = (error: unknown): boolean =>
  isRpcError(error, Code.NotFound, Code.PermissionDenied);

/** The session is absent, expired, or rejected — the caller must re-authenticate. */
export const isUnauthenticatedRpcError = (error: unknown): boolean =>
  isRpcError(error, Code.Unauthenticated);

/**
 * The set a session-scoped read may resolve to `null` / empty: no record, no
 * permission, or no valid session. Every other code is a real failure and has
 * to propagate to an error boundary.
 */
export const isExpectedNullableRpcError = (error: unknown): boolean =>
  isRpcError(error, Code.NotFound, Code.PermissionDenied, Code.Unauthenticated);

const REJECTED_REQUEST_DISPOSITIONS: ReadonlySet<RpcErrorDisposition> = new Set(
  [
    "conflict",
    "forbidden",
    "invalid-argument",
    "not-found",
    "precondition",
    "unauthenticated",
  ]
);

/**
 * The server rejected this request — bad input, a conflict, a missing record,
 * an unusable session. A form may render these as a message the user can act
 * on.
 *
 * Excludes `unavailable` (transport / overload) and `unexpected` (the server
 * broke, or the throw was not an RPC error at all): those say nothing the user
 * can fix and must reach an error boundary instead of becoming "入力内容に誤り
 * があります。".
 */
export const isRejectedRequestRpcError = (error: unknown): boolean =>
  REJECTED_REQUEST_DISPOSITIONS.has(rpcErrorDisposition(error));

/**
 * Let a failure the UI cannot explain reach the error boundary.
 *
 * Call it first in a `catch` that turns errors into a message: everything with
 * a disposition stays as a message the user can act on, and everything else —
 * `internal`, `unimplemented`, a bug in our own mapping code — is rethrown
 * instead of being flattened into "時間をおいて再試行してください。" and lost.
 */
export const rethrowUnclassifiedRpcError = (error: unknown): void => {
  if (rpcErrorDisposition(error) === "unexpected") {
    throw error;
  }
};

/**
 * The server's own message, without Connect's `[code]` prefix, or `null` when
 * the value is not an RPC error.
 *
 * Only for endpoints whose messages are written to be read by an operator —
 * SMTP and theme validation spell out which field is wrong. Everywhere else use
 * `rpcErrorMessage()`: a raw server message is untranslated and may leak
 * internals.
 */
export const rpcErrorRawMessage = (error: unknown): string | null => {
  if (error instanceof ConnectError) {
    return error.rawMessage;
  }
  if (isRehydratedConnectError(error)) {
    return error.message.replace(/^\[[a-z_]+\]\s*/u, "");
  }
  return null;
};

/** Whether a Connect error has a `google.rpc.BadRequest` violation for `field`. */
export const rpcErrorHasFieldViolation = (
  error: unknown,
  field: string
): boolean =>
  error instanceof ConnectError &&
  error
    .findDetails(BadRequestSchema)
    .some((detail) =>
      detail.fieldViolations.some((violation) => violation.field === field)
    );

/**
 * Whether a Connect error has a Publira-owned `google.rpc.ErrorInfo` reason.
 *
 * Details exist only while the original Connect error is available. A cached
 * function must therefore classify an error before it crosses a `"use cache"`
 * boundary, where Next.js re-creates it from name and message alone.
 */
export const rpcErrorHasReason = (
  error: unknown,
  reason: RpcErrorReason
): boolean =>
  error instanceof ConnectError &&
  error
    .findDetails(ErrorInfoSchema)
    .some(
      (detail) =>
        detail.domain === RPC_ERROR_INFO_DOMAIN && detail.reason === reason
    );
