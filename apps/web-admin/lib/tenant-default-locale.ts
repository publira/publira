import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorRawMessage,
} from "@publira/api-client/errors";
import { DEFAULT_LOCALE, parseLocale } from "@publira/utils/i18n";
import type { Locale } from "@publira/utils/i18n";
import { cacheTag } from "next/cache";

import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import { getAccessToken } from "./session";

export type GetTenantDefaultLocaleResult =
  | { ok: true; defaultLocale: Locale }
  | {
      ok: false;
      message: string;
      defaultLocale: Locale;
      /**
       * The API rejected the session — the settings screen raises the login
       * redirect. {@link getTenantDisplayLocale} ignores it on purpose: a
       * cookie-less request can still render in the fallback locale without
       * interrupting a page whose own read will report the same rejection.
       */
      requiresSignIn: boolean;
    };

export type UpdateTenantDefaultLocaleResult =
  | { ok: true; defaultLocale: Locale }
  | { ok: false; message: string };

const genericLoadErrorMessage =
  "既定言語の取得に失敗しました。時間をおいて再試行してください。";
const genericUpdateErrorMessage =
  "既定言語の保存に失敗しました。時間をおいて再試行してください。";
const sessionErrorMessage = "セッションが無効です。再ログインしてください。";

/**
 * Tag the settings screen's cached read carries, so `updateTag` in the Server
 * Action makes the saved value visible in the same session instead of leaving
 * the previous locale in the private cache.
 */
export const tenantDefaultLocaleCacheTag = (tenantId: string): string =>
  `tenant:${tenantId.trim()}:default-locale`;

/**
 * The server rejects an unknown locale with `invalid_argument` and names the
 * field, which is more useful to the operator than the generic wording.
 * Everything else takes the shared copy.
 */
const parseErrorMessage = (error: unknown, fallback: string): string => {
  const serverMessage = rpcErrorRawMessage(error)?.trim() || fallback;
  return rpcErrorMessage(error, fallback, {
    "invalid-argument": serverMessage,
  });
};

const resolveDefaultLocale = (value: string | undefined): Locale =>
  parseLocale(value?.trim());

export const getTenantDefaultLocale = async (
  tenantId: string
): Promise<GetTenantDefaultLocaleResult> => {
  "use cache: private";

  const sessionId = await getAccessToken();
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return {
      defaultLocale: DEFAULT_LOCALE,
      message: sessionErrorMessage,
      ok: false,
      requiresSignIn: !sessionId,
    };
  }

  cacheTag(tenantDefaultLocaleCacheTag(normalizedTenantId));

  try {
    const response = await apiClient.tenantSettings.getTenantDefaultLocale(
      {
        tenant: { tenantId: normalizedTenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      defaultLocale: resolveDefaultLocale(response.defaultLocale),
      ok: true,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      defaultLocale: DEFAULT_LOCALE,
      message: parseErrorMessage(error, genericLoadErrorMessage),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

/**
 * Locale the console falls back to when the operator has not chosen one
 * (#1046). One entry point, so a cookie-less request never hard-codes `ja`
 * by omission.
 *
 * An unavailable tenant read degrades to {@link DEFAULT_LOCALE} rather than
 * guessing. The read is tagged `tenant:<id>:default-locale`, which `updateTag`
 * invalidates when the value is saved, so a change reaches every screen in
 * the same session.
 */
export const getTenantDisplayLocale = async (
  tenantId: string
): Promise<Locale> => {
  const result = await getTenantDefaultLocale(tenantId);
  return result.defaultLocale;
};

export const updateTenantDefaultLocale = async (input: {
  tenantId: string;
  defaultLocale: Locale;
}): Promise<UpdateTenantDefaultLocaleResult> => {
  const sessionId = await getAccessToken();
  const normalizedTenantId = input.tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return { message: sessionErrorMessage, ok: false };
  }

  try {
    const response = await apiClient.tenantSettings.updateTenantDefaultLocale(
      {
        defaultLocale: input.defaultLocale,
        tenant: { tenantId: normalizedTenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      defaultLocale: resolveDefaultLocale(response.defaultLocale),
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
