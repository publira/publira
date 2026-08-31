import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorRawMessage,
} from "@publira/api-client/errors";
import { DEFAULT_LOCALE, getMessage, parseLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { DEFAULT_TIME_ZONE } from "@publira/utils";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheTag } from "next/cache";

import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";
import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./auth-shared";

/**
 * Loaded lazily so this module can keep exporting
 * {@link getPlatformDisplayLocale} for `lib/locale.ts` without a cycle.
 */
const loadPlatformMessages = async (locale: Locale) => {
  const { loadPlatformMessages: load } = await import("./locale");
  return load(locale);
};

export type GetPlatformSettingsResult =
  | { defaultLocale: Locale; defaultTimezone: string; ok: true }
  | {
      defaultLocale: Locale;
      defaultTimezone: string;
      message: string;
      ok: false;
      /**
       * The API rejected the session — the settings screen raises the login
       * redirect. {@link getPlatformDisplayTimeZone} and
       * {@link getPlatformDisplayLocale} ignore it on purpose: a date rendered
       * in the fallback zone, or copy rendered in the fallback locale, is not
       * worth interrupting a page whose own read will report the same
       * rejection.
       */
      requiresSignIn: boolean;
    };

export type UpdatePlatformDefaultTimezoneResult =
  | { defaultTimezone: string; ok: true }
  | { message: string; ok: false };

export type UpdatePlatformDefaultLocaleResult =
  | { defaultLocale: Locale; ok: true }
  | { message: string; ok: false };

/**
 * Tag the cached read carries, so `updateTag` in the Server Action makes the
 * saved value visible in the same session — both on the settings screen and on
 * the console screens that format their timestamps with it.
 */
export const platformSettingsCacheTag = "platform:settings";

/**
 * The server rejects an unknown IANA name with `invalid_argument` and names the
 * field ("default_timezone must be a valid IANA time zone name"), which is more
 * useful to the operator than the generic wording. Everything else takes the
 * shared copy. Same rule as `apps/web-admin/lib/tenant-timezone.ts`.
 */
const parseErrorMessage = (
  error: unknown,
  fallback: string,
  locale: Locale
): string => {
  const serverMessage = rpcErrorRawMessage(error)?.trim() || fallback;
  return rpcErrorMessage(error, fallback, {
    locale,
    overrides: {
      "invalid-argument": serverMessage,
    },
  });
};

export const getPlatformSettings = async (
  locale: Locale
): Promise<GetPlatformSettingsResult> => {
  "use cache: private";

  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    dropFailedCacheEntry();
    const messages = await loadPlatformMessages(locale);
    return {
      defaultLocale: DEFAULT_LOCALE,
      defaultTimezone: DEFAULT_TIME_ZONE,
      message: getMessage(messages, "errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: true,
    };
  }

  cacheTag(platformSettingsCacheTag);

  try {
    const response = await apiClient.settings.getPlatformSettings(
      {},
      buildSessionHeaders(sessionId)
    );

    return {
      // The server always answers a resolved locale code and IANA name; the
      // fallbacks only cover a response shape that predates the fields.
      defaultLocale: parseLocale(response.settings?.defaultLocale.trim()),
      defaultTimezone:
        response.settings?.defaultTimezone.trim() || DEFAULT_TIME_ZONE,
      ok: true,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    // A failed read stands in with the fallback zone and locale, so it must
    // not be cached: the console would keep formatting timestamps and
    // choosing copy with the stand-ins after the API recovers.
    dropFailedCacheEntry();
    const messages = await loadPlatformMessages(locale);
    return {
      defaultLocale: DEFAULT_LOCALE,
      defaultTimezone: DEFAULT_TIME_ZONE,
      message: parseErrorMessage(
        error,
        getMessage(messages, "platform.settings.load_failed"),
        locale
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

/**
 * Display zone for the platform console itself (dashboard, audit log, user
 * filters). A failed read degrades to {@link DEFAULT_TIME_ZONE} rather than to
 * the host's zone, so the wall clock never depends on where the container runs
 * (#564).
 */
export const getPlatformDisplayTimeZone = async (): Promise<string> => {
  // Error copy is unused here; DEFAULT_LOCALE only keys the cached read.
  const settings = await getPlatformSettings(DEFAULT_LOCALE);
  return settings.defaultTimezone;
};

/**
 * Display locale for the platform console itself when the operator has not
 * chosen one in the `publira_locale` cookie (#1047). A failed read degrades to
 * {@link DEFAULT_LOCALE} rather than interrupting the page.
 *
 * `/setup` does not come through here: it runs before the settings row exists,
 * so it resolves its own locale from `Accept-Language`. Removing this last
 * implicit fallback for the rest of the console is #1249.
 */
export const getPlatformDisplayLocale = async (): Promise<Locale> => {
  // Error copy is unused here; DEFAULT_LOCALE only keys the cached read.
  const settings = await getPlatformSettings(DEFAULT_LOCALE);
  return settings.defaultLocale;
};

interface StoredPlatformSettings {
  defaultLocale: Locale;
  defaultTimezone: string;
}

/**
 * The saved settings row, read straight from the API instead of through the
 * cached {@link getPlatformSettings}.
 *
 * `UpdatePlatformSettings` writes the whole row and requires both fields, so a
 * save that changes one of them has to name the other. The stored value is the
 * one to send back: the settings screen's copy can be minutes old, and posting
 * that back would revert what another session saved in the meantime.
 */
const readStoredPlatformSettings = async (
  sessionId: string
): Promise<StoredPlatformSettings | null> => {
  const current = await apiClient.settings.getPlatformSettings(
    {},
    buildSessionHeaders(sessionId)
  );
  const defaultTimezone = current.settings?.defaultTimezone.trim();
  const defaultLocale = current.settings?.defaultLocale.trim();
  if (!(defaultTimezone && defaultLocale)) {
    return null;
  }

  return { defaultLocale: parseLocale(defaultLocale), defaultTimezone };
};

export const updatePlatformDefaultTimezone = async (
  defaultTimezone: string,
  locale: Locale
): Promise<UpdatePlatformDefaultTimezoneResult> => {
  const [messages, sessionId] = await Promise.all([
    loadPlatformMessages(locale),
    resolveAccessToken(),
  ]);
  if (!sessionId) {
    return {
      message: getMessage(messages, "errors.rpc.unauthenticated"),
      ok: false,
    };
  }

  try {
    const stored = await readStoredPlatformSettings(sessionId);
    if (!stored) {
      return {
        message: getMessage(messages, "platform.settings.timezone_save_failed"),
        ok: false,
      };
    }

    const response = await apiClient.settings.updatePlatformSettings(
      { defaultLocale: stored.defaultLocale, defaultTimezone },
      buildSessionHeaders(sessionId)
    );

    return {
      defaultTimezone:
        response.settings?.defaultTimezone.trim() || DEFAULT_TIME_ZONE,
      ok: true,
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: parseErrorMessage(
        error,
        getMessage(messages, "platform.settings.timezone_save_failed"),
        locale
      ),
      ok: false,
    };
  }
};

/**
 * Save the platform-wide default locale.
 *
 * `UpdatePlatformSettings` writes the whole settings row and rejects a blank
 * `default_timezone`, so a locale-only save still has to name a zone —
 * {@link readStoredPlatformSettings} supplies the stored one.
 */
export const updatePlatformDefaultLocale = async (
  defaultLocale: Locale,
  locale: Locale
): Promise<UpdatePlatformDefaultLocaleResult> => {
  const [messages, sessionId] = await Promise.all([
    loadPlatformMessages(locale),
    resolveAccessToken(),
  ]);
  if (!sessionId) {
    return {
      message: getMessage(messages, "errors.rpc.unauthenticated"),
      ok: false,
    };
  }

  try {
    const stored = await readStoredPlatformSettings(sessionId);
    if (!stored) {
      return {
        message: getMessage(messages, "platform.settings.locale_save_failed"),
        ok: false,
      };
    }

    const response = await apiClient.settings.updatePlatformSettings(
      { defaultLocale, defaultTimezone: stored.defaultTimezone },
      buildSessionHeaders(sessionId)
    );

    return {
      defaultLocale: parseLocale(response.settings?.defaultLocale.trim()),
      ok: true,
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    // The form offers exactly the supported codes, so an `invalid-argument`
    // here is a forged request rather than something the operator can act on:
    // the shared copy says more than the server's field message would.
    return {
      message: rpcErrorMessage(
        error,
        getMessage(messages, "platform.settings.locale_save_failed"),
        { locale }
      ),
      ok: false,
    };
  }
};
