import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorRawMessage,
} from "@publira/api-client/errors";
import { getMessage, negotiateInitialLocale, parseLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { DEFAULT_TIME_ZONE } from "@publira/utils";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheTag } from "next/cache";
import { headers } from "next/headers";

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
      /**
       * No `defaultLocale`. A read that failed has no saved language to report,
       * and naming one anyway is how the settings screen would come to save a
       * value nobody chose over the stored one.
       */
      defaultTimezone: string;
      message: string;
      ok: false;
      /**
       * The API rejected the session — the settings screen raises the login
       * redirect. {@link getPlatformDisplayTimeZone} ignores it on purpose: a
       * date rendered in the fallback zone is not worth interrupting a page
       * whose own read will report the same rejection.
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

    const defaultLocale = parseLocale(response.settings?.defaultLocale.trim());
    if (defaultLocale === undefined) {
      // `default_locale` is documented as never empty and already resolved
      // against the platform default, so a code that fails to parse is one
      // this build has no catalog for.
      dropFailedCacheEntry();
      const messages = await loadPlatformMessages(locale);
      return {
        defaultTimezone: DEFAULT_TIME_ZONE,
        message: getMessage(messages, "platform.settings.load_failed"),
        ok: false,
        requiresSignIn: false,
      };
    }

    return {
      defaultLocale,
      defaultTimezone:
        response.settings?.defaultTimezone.trim() || DEFAULT_TIME_ZONE,
      ok: true,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    // A failed read stands in with the fallback zone, so it must not be
    // cached: the console would keep formatting timestamps with the stand-in
    // after the API recovers.
    dropFailedCacheEntry();
    const messages = await loadPlatformMessages(locale);
    return {
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
 * The saved row with no copy attached, so reading it needs no locale.
 *
 * {@link getPlatformSettings} words its failures, which makes it useless to
 * {@link getPlatformDisplayLocale}: resolving the locale would need the locale
 * the copy is in. This read answers the stored values or `null`, and each
 * display helper decides for itself what a missing answer means.
 */
const readPlatformSettings = async (): Promise<{
  defaultLocale: Locale;
  defaultTimezone: string;
} | null> => {
  "use cache: private";

  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    dropFailedCacheEntry();
    return null;
  }

  cacheTag(platformSettingsCacheTag);

  try {
    const response = await apiClient.settings.getPlatformSettings(
      {},
      buildSessionHeaders(sessionId)
    );
    const defaultLocale = parseLocale(response.settings?.defaultLocale.trim());
    if (defaultLocale === undefined) {
      dropFailedCacheEntry();
      return null;
    }

    return {
      defaultLocale,
      defaultTimezone:
        response.settings?.defaultTimezone.trim() || DEFAULT_TIME_ZONE,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    dropFailedCacheEntry();
    return null;
  }
};

/**
 * Display zone for the platform console itself (dashboard, audit log, user
 * filters). A failed read degrades to {@link DEFAULT_TIME_ZONE} rather than to
 * the host's zone, so the wall clock never depends on where the container runs
 * (#564).
 */
export const getPlatformDisplayTimeZone = async (): Promise<string> => {
  const settings = await readPlatformSettings();
  return settings?.defaultTimezone ?? DEFAULT_TIME_ZONE;
};

/**
 * Display locale for the platform console itself when the operator has not
 * chosen one in the `publira_locale` cookie (#1047).
 *
 * The stored setting is the answer whenever it can be read. It cannot be on the
 * screens that exist to create a session — the login form above all, where
 * `GetPlatformSettings` has no session to authorize — so those fall through to
 * what the browser asked for in `Accept-Language`. That is a statement about
 * the person in front of the screen rather than a language picked for them,
 * which is the same reason `/setup` opens on it.
 */
export const getPlatformDisplayLocale = async (): Promise<Locale> => {
  const settings = await readPlatformSettings();
  if (settings) {
    return settings.defaultLocale;
  }

  const requestHeaders = await headers();
  return negotiateInitialLocale(requestHeaders.get("accept-language"));
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

  const parsedLocale = parseLocale(defaultLocale);
  if (parsedLocale === undefined) {
    return null;
  }

  return { defaultLocale: parsedLocale, defaultTimezone };
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

    const saved = parseLocale(response.settings?.defaultLocale.trim());
    if (saved === undefined) {
      return {
        message: getMessage(messages, "platform.settings.locale_save_failed"),
        ok: false,
      };
    }

    return { defaultLocale: saved, ok: true };
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
