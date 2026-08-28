import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  Code,
  isRpcError,
  rethrowUnclassifiedRpcError,
  rpcErrorDisposition,
} from "@publira/api-client/errors";
import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";

import { apiClient } from "./api-client";
import { loadPlatformMessages } from "./locale";

/**
 * Setup status is unknown rather than failed when the platform has not been
 * initialized yet: the RPC answers `not_found` before the first tenant exists
 * and `failed_precondition` while bootstrap is still running.
 */
const isSetupStatusUnknownError = (error: unknown): boolean =>
  isRpcError(error, Code.NotFound, Code.FailedPrecondition);

const readSetupStatus = async (): Promise<boolean | null> => {
  try {
    const response = await apiClient.setup.checkSetupStatus({});
    return response.setupCompleted;
  } catch (error) {
    if (isSetupStatusUnknownError(error)) {
      return null;
    }
    throw error;
  }
};

/**
 * The setup page needs to distinguish an uninitialized platform from a status
 * it could not read. `null` alone cannot represent both states.
 */
export type SetupStatus =
  | { available: false }
  | { available: true; completed: boolean | null };

export const isSetupCompleted = async (): Promise<SetupStatus> => {
  "use cache: private";

  try {
    return { available: true, completed: await readSetupStatus() };
  } catch {
    // A cache fill must not throw: the page can render its API-unavailable
    // message, while a successful read on the next request replaces it.
    dropFailedCacheEntry();
    return { available: false };
  }
};

/**
 * The last setup state the platform API answered with, for this server process.
 * `undefined` while it has never answered one — a freshly started instance, or
 * one that has only ever seen the API down.
 */
let lastKnownSetupState: boolean | null | undefined;

/**
 * Setup state for `proxy.ts`, which has to keep routing while the platform API
 * is unreachable.
 *
 * A proxy that rejects answers a bare `500` for every path it matches: no page
 * renders, so neither `app/error.tsx` nor `global-error.tsx` is reached, and
 * the console cannot even show its login screen. Routing therefore falls back
 * to the last state the API confirmed, the same shape `web-admin` uses to keep
 * serving on its cached tenant resolution.
 *
 * A process that has never had an answer falls back to "completed", so the
 * outage sends the operator to `/login` rather than re-opening the setup form
 * on a platform that was bootstrapped long ago. There is deliberately no TTL on
 * the fallback: the API is asked on every request and only a failure reads the
 * stored value, so a platform that finishes setup is routed on the new state at
 * once.
 */
export const resolveSetupCompleted = async (): Promise<boolean | null> => {
  try {
    const completed = await readSetupStatus();
    lastKnownSetupState = completed;
    return completed;
  } catch {
    return lastKnownSetupState === undefined ? true : lastKnownSetupState;
  }
};

export type SetupResult =
  | { ok: true }
  | {
      ok: false;
      message: string;
      /** Setup already ran; the caller sends the operator to login instead. */
      alreadyCompleted: boolean;
    };

export const createInitialUser = async (
  name: string,
  email: string,
  password: string,
  locale: Locale
): Promise<SetupResult> => {
  try {
    await apiClient.setup.createInitialUser({ email, name, password });
    return { ok: true };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    const messages = await loadPlatformMessages(locale);

    return {
      // `already_exists` is only ever raised here for "setup already completed"
      // (`server/api/platformapi/setup_handlers.go`).
      alreadyCompleted: rpcErrorDisposition(error) === "conflict",
      message: rpcErrorMessage(
        error,
        getMessage(messages, "platform.auth.errors.setup_failed"),
        {
          locale,
          overrides: {
            conflict: getMessage(
              messages,
              "platform.auth.errors.setup_already_completed"
            ),
          },
        }
      ),
      ok: false,
    };
  }
};
