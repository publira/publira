import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorRawMessage,
} from "@publira/api-client/errors";
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

export type GetPlatformSettingsResult =
  | { defaultTimezone: string; ok: true }
  | {
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

const genericLoadErrorMessage =
  "プラットフォーム設定の取得に失敗しました。時間をおいて再試行してください。";
const genericUpdateErrorMessage =
  "既定タイムゾーンの保存に失敗しました。時間をおいて再試行してください。";
const sessionErrorMessage = "セッションが無効です。再ログインしてください。";

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
const parseErrorMessage = (error: unknown, fallback: string): string => {
  const serverMessage = rpcErrorRawMessage(error)?.trim() || fallback;
  return rpcErrorMessage(error, fallback, {
    "invalid-argument": serverMessage,
  });
};

export const getPlatformSettings =
  async (): Promise<GetPlatformSettingsResult> => {
    "use cache: private";

    const sessionId = await resolveAccessToken();
    if (!sessionId) {
      dropFailedCacheEntry();
      return {
        defaultTimezone: DEFAULT_TIME_ZONE,
        message: sessionErrorMessage,
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
        // The server always answers a resolved IANA name; the fallback only
        // covers a response shape that predates the field.
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
      return {
        defaultTimezone: DEFAULT_TIME_ZONE,
        message: parseErrorMessage(error, genericLoadErrorMessage),
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
  const settings = await getPlatformSettings();
  return settings.defaultTimezone;
};

export const updatePlatformDefaultTimezone = async (
  defaultTimezone: string
): Promise<UpdatePlatformDefaultTimezoneResult> => {
  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    return { message: sessionErrorMessage, ok: false };
  }

  try {
    const response = await apiClient.settings.updatePlatformSettings(
      { defaultTimezone },
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
      message: parseErrorMessage(error, genericUpdateErrorMessage),
      ok: false,
    };
  }
};
