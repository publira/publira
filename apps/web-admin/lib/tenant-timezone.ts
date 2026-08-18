import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorRawMessage,
} from "@publira/api-client/errors";
import { DEFAULT_TIME_ZONE } from "@publira/utils";
import { cacheTag } from "next/cache";

import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import { getAccessToken } from "./session";

export type GetTenantTimezoneResult =
  | { ok: true; timezone: string }
  | {
      ok: false;
      message: string;
      timezone: string;
      /**
       * The API rejected the session — the settings screen raises the login
       * redirect. {@link getTenantDisplayTimeZone} ignores it on purpose: a
       * date rendered in the fallback zone is not worth interrupting a page
       * whose own read will report the same rejection.
       */
      requiresSignIn: boolean;
    };

export type UpdateTenantTimezoneResult =
  | { ok: true; timezone: string }
  | { ok: false; message: string };

const genericLoadErrorMessage =
  "タイムゾーンの取得に失敗しました。時間をおいて再試行してください。";
const genericUpdateErrorMessage =
  "タイムゾーンの保存に失敗しました。時間をおいて再試行してください。";
const sessionErrorMessage = "セッションが無効です。再ログインしてください。";

/**
 * Tag the settings screen's cached read carries, so `updateTag` in the Server
 * Action makes the saved value visible in the same session instead of leaving
 * the previous zone in the private cache.
 */
export const tenantTimezoneCacheTag = (tenantId: string): string =>
  `tenant:${tenantId.trim()}:timezone`;

/**
 * The server rejects an unknown IANA name with `invalid_argument` and names the
 * field ("timezone must be a valid IANA time zone name"), which is more useful
 * to the operator than the generic wording. Everything else takes the shared copy.
 */
const parseErrorMessage = (error: unknown, fallback: string): string => {
  const serverMessage = rpcErrorRawMessage(error)?.trim() || fallback;
  return rpcErrorMessage(error, fallback, {
    "invalid-argument": serverMessage,
  });
};

export const getTenantTimezone = async (
  tenantId: string
): Promise<GetTenantTimezoneResult> => {
  "use cache: private";

  const sessionId = await getAccessToken();
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return {
      message: sessionErrorMessage,
      ok: false,
      requiresSignIn: !sessionId,
      timezone: DEFAULT_TIME_ZONE,
    };
  }

  cacheTag(tenantTimezoneCacheTag(normalizedTenantId));

  try {
    const response = await apiClient.tenantSettings.getTenantTimezone(
      {
        tenant: { tenantId: normalizedTenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      ok: true,
      // The server always answers a resolved IANA name; the fallback only
      // covers a response shape that predates the field.
      timezone: response.timezone.trim() || DEFAULT_TIME_ZONE,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: parseErrorMessage(error, genericLoadErrorMessage),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
      timezone: DEFAULT_TIME_ZONE,
    };
  }
};

/**
 * Display / conversion zone for every date the admin console shows or accepts
 * (#566). One entry point, so a screen never falls back to the fixed
 * `DEFAULT_TIME_ZONE` by omission and the console agrees with the public site
 * about what the tenant's wall clock is.
 *
 * An unavailable tenant read degrades to {@link DEFAULT_TIME_ZONE} rather than
 * to the host's zone, so the rendered wall clock never depends on where the
 * container runs (#564). The read is tagged `tenant:<id>:timezone`, which
 * `updateTag` invalidates when the zone is saved, so a change reaches every
 * screen in the same session.
 */
export const getTenantDisplayTimeZone = async (
  tenantId: string
): Promise<string> => {
  const result = await getTenantTimezone(tenantId);
  return result.timezone;
};

export const updateTenantTimezone = async (input: {
  tenantId: string;
  timezone: string;
}): Promise<UpdateTenantTimezoneResult> => {
  const sessionId = await getAccessToken();
  const normalizedTenantId = input.tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return { message: sessionErrorMessage, ok: false };
  }

  try {
    const response = await apiClient.tenantSettings.updateTenantTimezone(
      {
        tenant: { tenantId: normalizedTenantId },
        timezone: input.timezone,
      },
      withSessionHeaders(sessionId)
    );

    return {
      ok: true,
      timezone: response.timezone.trim() || DEFAULT_TIME_ZONE,
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
