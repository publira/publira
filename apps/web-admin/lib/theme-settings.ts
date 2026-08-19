import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorRawMessage,
} from "@publira/api-client/errors";
import { resolveTenantThemeColors } from "@publira/utils/theme-css-variables";
import type { TenantThemeColors } from "@publira/utils/theme-css-variables";
import { cacheTag } from "next/cache";

import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import { mentionsFaviconRejection } from "./image-rejection";
import { getAccessToken } from "./session";

export interface UpdateTenantThemeSettingsInput extends TenantThemeColors {
  tenantId: string;
}

export type TenantThemeSettingsResult =
  | { ok: true; theme: TenantThemeColors; faviconUrl: string }
  | {
      ok: false;
      message: string;
      /**
       * The API rejected the session while reading the theme — the page raises
       * the login redirect. The save path throws instead, so only
       * {@link getTenantThemeSettings} ever sets it.
       */
      requiresSignIn?: boolean;
    };

export type TenantFaviconResult =
  | { ok: true; faviconUrl: string }
  | { ok: false; message: string };

export interface UploadTenantFaviconInput {
  tenantId: string;
  faviconContentType: string;
  faviconData: Uint8Array;
}

const genericLoadErrorMessage =
  "テーマの取得に失敗しました。時間をおいて再試行してください。";
const genericUpdateErrorMessage =
  "テーマの保存に失敗しました。時間をおいて再試行してください。";
const genericFaviconUploadErrorMessage =
  "ファビコンのアップロードに失敗しました。時間をおいて再試行してください。";
const genericFaviconDeleteErrorMessage =
  "ファビコンの削除に失敗しました。時間をおいて再試行してください。";
const rejectedFaviconMessage =
  "画像を読み込めませんでした。32x32px 以上の JPEG / PNG / WebP を選択してください。";
const sessionErrorMessage = "セッションが無効です。再ログインしてください。";

/**
 * Tag the settings screen's cached read carries, so `updateTag` in a Server
 * Action makes a saved theme or a replaced favicon visible in the same session
 * instead of leaving the previous value in the private cache.
 */
export const tenantThemeCacheTag = (tenantId: string): string =>
  `tenant:${tenantId.trim()}:theme-settings`;

/**
 * Theme validation errors name the offending field ("theme.primary_color must
 * be a hex color"), so the server's own text is more useful to the operator
 * than the generic wording. Everything else takes the shared copy.
 */
const parseErrorMessage = (error: unknown, fallback: string): string => {
  const serverMessage = rpcErrorRawMessage(error)?.trim() || fallback;
  return rpcErrorMessage(error, fallback, {
    "invalid-argument": serverMessage,
    precondition: serverMessage,
  });
};

/**
 * The favicon rejections are worded here rather than taken from the server: the
 * handler answers in English, and the two cases it rejects — a source smaller
 * than 32px and an image it cannot decode — are already covered by one sentence
 * naming what the screen accepts. The `favicon_data` field violation is what
 * separates a rejected image from any other `invalid_argument`.
 */
const parseFaviconErrorMessage = (error: unknown, fallback: string): string =>
  rpcErrorMessage(
    error,
    fallback,
    mentionsFaviconRejection(error)
      ? { "invalid-argument": rejectedFaviconMessage }
      : undefined
  );

const toTenantTheme = (
  theme?: Partial<TenantThemeColors> | null
): TenantThemeColors => resolveTenantThemeColors(theme);

export const getTenantThemeSettings = async (
  tenantId: string
): Promise<TenantThemeSettingsResult> => {
  "use cache: private";

  cacheTag(tenantThemeCacheTag(tenantId));

  const sessionId = await getAccessToken();
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return {
      message: sessionErrorMessage,
      ok: false,
      requiresSignIn: !sessionId,
    };
  }

  try {
    const response = await apiClient.theme.getTenantTheme(
      {
        tenant: { tenantId: normalizedTenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      faviconUrl: response.theme?.faviconUrl ?? "",
      ok: true,
      theme: toTenantTheme(response.theme),
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: parseErrorMessage(error, genericLoadErrorMessage),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

export const updateTenantThemeSettings = async (
  input: UpdateTenantThemeSettingsInput
): Promise<TenantThemeSettingsResult> => {
  const sessionId = await getAccessToken();
  const normalizedTenantId = input.tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return { message: sessionErrorMessage, ok: false };
  }

  try {
    const response = await apiClient.theme.upsertTenantTheme(
      {
        tenant: { tenantId: normalizedTenantId },
        theme: {
          accentColor: input.accentColor,
          accentForegroundColor: input.accentForegroundColor,
          backgroundColor: input.backgroundColor,
          borderColor: input.borderColor,
          cardColor: input.cardColor,
          cardForegroundColor: input.cardForegroundColor,
          destructiveColor: input.destructiveColor,
          destructiveForegroundColor: input.destructiveForegroundColor,
          foregroundColor: input.foregroundColor,
          infoColor: input.infoColor,
          infoForegroundColor: input.infoForegroundColor,
          inputColor: input.inputColor,
          mutedColor: input.mutedColor,
          mutedForegroundColor: input.mutedForegroundColor,
          popoverColor: input.popoverColor,
          popoverForegroundColor: input.popoverForegroundColor,
          primaryColor: input.primaryColor,
          primaryForegroundColor: input.primaryForegroundColor,
          ringColor: input.ringColor,
          secondaryColor: input.secondaryColor,
          secondaryForegroundColor: input.secondaryForegroundColor,
          successColor: input.successColor,
          successForegroundColor: input.successForegroundColor,
          surfaceColor: input.surfaceColor,
          surfaceForegroundColor: input.surfaceForegroundColor,
          warningColor: input.warningColor,
          warningForegroundColor: input.warningForegroundColor,
        },
      },
      withSessionHeaders(sessionId)
    );

    return {
      faviconUrl: response.theme?.faviconUrl ?? "",
      ok: true,
      theme: toTenantTheme(response.theme),
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

export const uploadTenantFavicon = async (
  input: UploadTenantFaviconInput
): Promise<TenantFaviconResult> => {
  const sessionId = await getAccessToken();
  const normalizedTenantId = input.tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return { message: sessionErrorMessage, ok: false };
  }

  try {
    const response = await apiClient.theme.uploadTenantFavicon(
      {
        faviconContentType: input.faviconContentType,
        faviconData: input.faviconData,
        tenant: { tenantId: normalizedTenantId },
      },
      withSessionHeaders(sessionId)
    );

    return { faviconUrl: response.theme?.faviconUrl ?? "", ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: parseFaviconErrorMessage(
        error,
        genericFaviconUploadErrorMessage
      ),
      ok: false,
    };
  }
};

export const deleteTenantFavicon = async (
  tenantId: string
): Promise<TenantFaviconResult> => {
  const sessionId = await getAccessToken();
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return { message: sessionErrorMessage, ok: false };
  }

  try {
    const response = await apiClient.theme.deleteTenantFavicon(
      { tenant: { tenantId: normalizedTenantId } },
      withSessionHeaders(sessionId)
    );

    return { faviconUrl: response.theme?.faviconUrl ?? "", ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: parseFaviconErrorMessage(
        error,
        genericFaviconDeleteErrorMessage
      ),
      ok: false,
    };
  }
};
