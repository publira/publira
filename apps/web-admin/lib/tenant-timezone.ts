import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorRawMessage,
} from "@publira/api-client/errors";
import { DEFAULT_TIME_ZONE } from "@publira/utils";
import { cacheTag } from "next/cache";

import { apiClient, withSessionHeaders } from "./api";
import { getAccessToken } from "./session";

export type GetTenantTimezoneResult =
  | { ok: true; timezone: string }
  | { ok: false; message: string; timezone: string };

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
      timezone: DEFAULT_TIME_ZONE,
    };
  }
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
    rethrowUnclassifiedRpcError(error);
    return {
      message: parseErrorMessage(error, genericUpdateErrorMessage),
      ok: false,
    };
  }
};
