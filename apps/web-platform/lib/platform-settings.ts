import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorRawMessage,
} from "@publira/api-client/errors";
import { parseLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { DEFAULT_TIME_ZONE } from "@publira/utils";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheLife, cacheTag } from "next/cache";

import {
  SHARED_READ_CACHE_LIFE,
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
  withServiceHeaders,
} from "./api-client";
import { verifyPlatformSession } from "./auth-session";
import { rethrowUnauthenticatedRpcError } from "./auth-shared";
import { getPlatformLocale } from "./locale";
import { getMessagesFor } from "./messages";

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
 *
 * `conflictMessage` replaces the `precondition` wording for a save the server
 * refused because the settings row moved on. A read has no such category, so it
 * passes none.
 */
const parseErrorMessage = (
  error: unknown,
  fallback: string,
  locale: Locale,
  conflictMessage?: string
): string => {
  const serverMessage = rpcErrorRawMessage(error)?.trim() || fallback;
  return rpcErrorMessage(error, fallback, {
    locale,
    overrides: {
      "invalid-argument": serverMessage,
      ...(conflictMessage ? { precondition: conflictMessage } : {}),
    },
  });
};

const getPlatformSettingsForLocale = async (
  locale: Locale
): Promise<GetPlatformSettingsResult> => {
  "use cache";
  cacheLife(SHARED_READ_CACHE_LIFE);
  cacheTag(platformSettingsCacheTag);

  try {
    const response = await apiClient.settings.getPlatformSettings(
      {},
      withServiceHeaders()
    );

    const defaultLocale = parseLocale(response.settings?.defaultLocale.trim());
    if (defaultLocale === undefined) {
      // `default_locale` is documented as never empty and already resolved
      // against the platform default, so a code that fails to parse is one
      // this build has no catalog for.
      dropFailedCacheEntry();
      const t = await getMessagesFor(locale);
      return {
        defaultTimezone: DEFAULT_TIME_ZONE,
        message: t("platform.settings.load_failed"),
        ok: false,
      };
    }

    return {
      defaultLocale,
      defaultTimezone:
        response.settings?.defaultTimezone.trim() || DEFAULT_TIME_ZONE,
      ok: true,
    };
  } catch (error) {
    // A `"use cache"` scope cannot rethrow: the fill would fail the whole
    // request. A failed read stands in with the fallback zone, so the entry is
    // dropped too: the console would keep formatting timestamps with the
    // stand-in after the API recovers.
    dropFailedCacheEntry();
    const t = await getMessagesFor(locale);
    return {
      defaultTimezone: DEFAULT_TIME_ZONE,
      message: parseErrorMessage(
        error,
        t("platform.settings.load_failed"),
        locale
      ),
      ok: false,
    };
  }
};

/**
 * The saved platform settings, for the General settings screen and the setup
 * checklist.
 *
 * Read with the service credential: the settings are the same for every
 * operator, so one entry serves all of them.
 */
export const getPlatformSettings =
  async (): Promise<GetPlatformSettingsResult> => {
    await verifyPlatformSession();
    return getPlatformSettingsForLocale(await getPlatformLocale());
  };

/**
 * The saved display zone, with no copy attached so reading it needs no locale.
 *
 * {@link getPlatformSettings} words its failures, which a caller after the
 * zone alone has no use for: this read answers the stored zone or `null`, and
 * {@link getPlatformDisplayTimeZone} decides what a missing answer means.
 */
const readPlatformDefaultTimezone = async (): Promise<string | null> => {
  "use cache";
  cacheLife(SHARED_READ_CACHE_LIFE);
  cacheTag(platformSettingsCacheTag);

  try {
    const response = await apiClient.settings.getPlatformSettings(
      {},
      withServiceHeaders()
    );
    return response.settings?.defaultTimezone.trim() || DEFAULT_TIME_ZONE;
  } catch {
    dropFailedCacheEntry();
    return null;
  }
};

/**
 * Display zone for the platform console itself (dashboard, audit log, user
 * filters). A failed read degrades to {@link DEFAULT_TIME_ZONE} rather than to
 * the host's zone, so the wall clock never depends on where the container runs.
 */
export const getPlatformDisplayTimeZone = async (): Promise<string> => {
  await verifyPlatformSession();
  return (await readPlatformDefaultTimezone()) ?? DEFAULT_TIME_ZONE;
};

interface StoredPlatformSettings {
  defaultLocale: Locale;
  defaultTimezone: string;
  /** Version of the row these values came from, sent back with the save. */
  revision: bigint;
}

/**
 * The saved settings row, read straight from the API instead of through the
 * cached {@link getPlatformSettings}.
 *
 * `UpdatePlatformSettings` writes the whole row and requires both fields, so a
 * save that changes one of them has to name the other. The stored value is the
 * one to send back: the settings screen's copy can be minutes old, and posting
 * that back would revert what another session saved in the meantime.
 *
 * The revision comes along for the window this read cannot close by itself —
 * another session saving between it and the write. The server compares it
 * against the locked row and refuses the save instead of writing the value read
 * here over the newer one.
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
  const revision = current.settings?.revision;
  if (!(defaultTimezone && defaultLocale && revision)) {
    return null;
  }

  const parsedLocale = parseLocale(defaultLocale);
  if (parsedLocale === undefined) {
    return null;
  }

  return { defaultLocale: parsedLocale, defaultTimezone, revision };
};

export const updatePlatformDefaultTimezone = async (
  defaultTimezone: string,
  locale: Locale
): Promise<UpdatePlatformDefaultTimezoneResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    resolveAccessToken(),
  ]);
  if (!sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
    };
  }

  try {
    const stored = await readStoredPlatformSettings(sessionId);
    if (!stored) {
      return {
        message: t("platform.settings.timezone_save_failed"),
        ok: false,
      };
    }

    const response = await apiClient.settings.updatePlatformSettings(
      {
        defaultLocale: stored.defaultLocale,
        defaultTimezone,
        expectedRevision: stored.revision,
      },
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
        t("platform.settings.timezone_save_failed"),
        locale,
        t("platform.settings.save_conflict")
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
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    resolveAccessToken(),
  ]);
  if (!sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
    };
  }

  try {
    const stored = await readStoredPlatformSettings(sessionId);
    if (!stored) {
      return {
        message: t("platform.settings.locale_save_failed"),
        ok: false,
      };
    }

    const response = await apiClient.settings.updatePlatformSettings(
      {
        defaultLocale,
        defaultTimezone: stored.defaultTimezone,
        expectedRevision: stored.revision,
      },
      buildSessionHeaders(sessionId)
    );

    const saved = parseLocale(response.settings?.defaultLocale.trim());
    if (saved === undefined) {
      return {
        message: t("platform.settings.locale_save_failed"),
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
        t("platform.settings.locale_save_failed"),
        {
          locale,
          overrides: {
            precondition: t("platform.settings.save_conflict"),
          },
        }
      ),
      ok: false,
    };
  }
};
