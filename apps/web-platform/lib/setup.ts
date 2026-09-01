import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  Code,
  isRpcError,
  rethrowUnclassifiedRpcError,
  rpcErrorDisposition,
} from "@publira/api-client/errors";
import { getMessage, parseLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import type { ResolvedLocaleState } from "@publira/utils/resolved-locale";

import { apiClient } from "./api-client";
import { loadPlatformMessages } from "./locale";

/**
 * Setup status is unknown rather than failed when the platform has not been
 * initialized yet: the RPC answers `not_found` before the first tenant exists
 * and `failed_precondition` while bootstrap is still running.
 */
const isSetupStatusUnknownError = (error: unknown): boolean =>
  isRpcError(error, Code.NotFound, Code.FailedPrecondition);

/**
 * What `CheckSetupStatus` answers, as the console uses it.
 *
 * `completed` is `null` while the platform has not been initialized yet, and
 * `defaultLocale` is `null` until a language has been saved — which is the same
 * moment, since `CreateInitialUser` writes the settings row.
 */
interface SetupStatusResponse {
  completed: boolean | null;
  defaultLocale: Locale | null;
}

const readSetupStatus = async (): Promise<SetupStatusResponse> => {
  try {
    const response = await apiClient.setup.checkSetupStatus({});
    return {
      completed: response.setupCompleted,
      defaultLocale: parseLocale(response.defaultLocale.trim()) ?? null,
    };
  } catch (error) {
    if (isSetupStatusUnknownError(error)) {
      return { completed: null, defaultLocale: null };
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
    const { completed } = await readSetupStatus();
    return { available: true, completed };
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
 * The last answer the platform API gave about the saved default locale, for
 * this server process. It starts `"unknown"` — a freshly started instance, or
 * one that has only ever seen the API down, knows nothing about the saved
 * language and must leave whatever the browser holds alone.
 */
let lastKnownDefaultLocale: ResolvedLocaleState = "unknown";

/**
 * What {@link resolveSetupState} answers.
 *
 * `defaultLocale` is the browser-facing state rather than the raw setting:
 * `"none"` and `"unknown"` are different instructions to
 * `applyResolvedLocaleCookie`, and this module is the only place that knows
 * which of the two an empty answer was.
 */
export interface SetupState {
  completed: boolean | null;
  defaultLocale: ResolvedLocaleState;
}

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
 *
 * `defaultLocale` rides along because this is the one platform read that
 * happens on every request without a session: the proxy hands it to the browser
 * (`@publira/utils/resolved-locale`), which is how `<html lang>` and the client
 * error boundary come to name the saved language instead of the visitor's. It
 * follows the same rule as the routing state — an outage keeps the last
 * confirmed language rather than dropping to none, because the outage did not
 * change what the platform saved, and a process that has never had an answer
 * says `"unknown"` so the browser keeps what an earlier one published.
 *
 * Only an outage. An answer that names no supported language is an answer, and
 * it replaces the remembered one with `"none"`: a platform whose saved code this
 * build has no catalog for must not have the previous language published on its
 * behalf, and the cookie a previous answer left behind is expired.
 */
export const resolveSetupState = async (): Promise<SetupState> => {
  try {
    const { completed, defaultLocale } = await readSetupStatus();
    lastKnownSetupState = completed;
    lastKnownDefaultLocale = defaultLocale ?? "none";
    return { completed, defaultLocale: lastKnownDefaultLocale };
  } catch {
    return {
      completed: lastKnownSetupState === undefined ? true : lastKnownSetupState,
      defaultLocale: lastKnownDefaultLocale,
    };
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

export interface CreateInitialUserInput {
  /** Platform default language the operator chose on the setup form. */
  defaultLocale: Locale;
  email: string;
  /** Locale the failure copy is rendered in, not the value being saved. */
  locale: Locale;
  name: string;
  password: string;
}

export const createInitialUser = async ({
  defaultLocale,
  email,
  locale,
  name,
  password,
}: CreateInitialUserInput): Promise<SetupResult> => {
  try {
    await apiClient.setup.createInitialUser({
      defaultLocale,
      email,
      name,
      password,
    });
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
