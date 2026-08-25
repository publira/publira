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
import {
  mentionsIconRejection,
  mentionsLogoRejection,
} from "./image-rejection";
import { getAccessToken } from "./session";
import { toTenantBrandingImage } from "./tenant-branding-image";
import type { TenantBrandingImage } from "./tenant-branding-image";

export interface UpdateTenantThemeSettingsInput extends TenantThemeColors {
  tenantId: string;
}

export type TenantThemeSettingsResult =
  | {
      ok: true;
      theme: TenantThemeColors;
      icon: TenantBrandingImage | null;
      logo: TenantBrandingImage | null;
    }
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

export type TenantIconResult =
  | { ok: true; icon: TenantBrandingImage | null }
  | { ok: false; message: string };

export type TenantLogoResult =
  | { ok: true; logo: TenantBrandingImage | null }
  | { ok: false; message: string };

export interface UploadTenantIconInput {
  tenantId: string;
  iconContentType: string;
  iconData: Uint8Array;
}

export interface UploadTenantLogoInput {
  tenantId: string;
  logoContentType: string;
  logoData: Uint8Array;
}

const genericLoadErrorMessage =
  "テーマの取得に失敗しました。時間をおいて再試行してください。";
const genericUpdateErrorMessage =
  "テーマの保存に失敗しました。時間をおいて再試行してください。";
const genericIconUploadErrorMessage =
  "アイコンのアップロードに失敗しました。時間をおいて再試行してください。";
const genericIconDeleteErrorMessage =
  "アイコンの削除に失敗しました。時間をおいて再試行してください。";
const genericLogoUploadErrorMessage =
  "ロゴのアップロードに失敗しました。時間をおいて再試行してください。";
const genericLogoDeleteErrorMessage =
  "ロゴの削除に失敗しました。時間をおいて再試行してください。";
const rejectedIconMessage =
  "画像を読み込めませんでした。32x32px 以上の JPEG / PNG / WebP を選択してください。";
const rejectedLogoMessage =
  "画像を読み込めませんでした。縦横とも 32px 以上の JPEG / PNG / WebP を選択してください。";
const sessionErrorMessage = "セッションが無効です。再ログインしてください。";

/**
 * Tag the settings screen's cached read carries, so `updateTag` in a Server
 * Action makes a saved theme or a replaced icon visible in the same session
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
 * The icon rejections are worded here rather than taken from the server: the
 * handler answers in English, and the two cases it rejects — a source smaller
 * than 32px and an image it cannot decode — are already covered by one sentence
 * naming what the screen accepts. The `icon_data` field violation is what
 * separates a rejected image from any other `invalid_argument`.
 */
const parseIconErrorMessage = (error: unknown, fallback: string): string =>
  rpcErrorMessage(
    error,
    fallback,
    mentionsIconRejection(error)
      ? { "invalid-argument": rejectedIconMessage }
      : undefined
  );

/** The logo rejections are worded here for the same reason as the icon's. */
const parseLogoErrorMessage = (error: unknown, fallback: string): string =>
  rpcErrorMessage(
    error,
    fallback,
    mentionsLogoRejection(error)
      ? { "invalid-argument": rejectedLogoMessage }
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
      icon: toTenantBrandingImage(
        response.theme?.iconImageUpdatedAt,
        response.theme?.iconImageVariants
      ),
      logo: toTenantBrandingImage(
        response.theme?.logoImageUpdatedAt,
        response.theme?.logoImageVariants
      ),
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

/**
 * Logo for the console chrome. An unset theme, a classified RPC failure, or
 * an unexpected throw all become `null` — the shell keeps the tenant-name
 * text instead of taking the layout down.
 */
export const getTenantThemeLogo = async (
  tenantId: string
): Promise<TenantBrandingImage | null> => {
  try {
    const result = await getTenantThemeSettings(tenantId);
    return result.ok ? result.logo : null;
  } catch {
    return null;
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
      icon: toTenantBrandingImage(
        response.theme?.iconImageUpdatedAt,
        response.theme?.iconImageVariants
      ),
      logo: toTenantBrandingImage(
        response.theme?.logoImageUpdatedAt,
        response.theme?.logoImageVariants
      ),
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

export const uploadTenantIcon = async (
  input: UploadTenantIconInput
): Promise<TenantIconResult> => {
  const sessionId = await getAccessToken();
  const normalizedTenantId = input.tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return { message: sessionErrorMessage, ok: false };
  }

  try {
    const response = await apiClient.theme.uploadTenantIcon(
      {
        iconContentType: input.iconContentType,
        iconData: input.iconData,
        tenant: { tenantId: normalizedTenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      icon: toTenantBrandingImage(
        response.theme?.iconImageUpdatedAt,
        response.theme?.iconImageVariants
      ),
      ok: true,
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: parseIconErrorMessage(error, genericIconUploadErrorMessage),
      ok: false,
    };
  }
};

export const deleteTenantIcon = async (
  tenantId: string
): Promise<TenantIconResult> => {
  const sessionId = await getAccessToken();
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return { message: sessionErrorMessage, ok: false };
  }

  try {
    const response = await apiClient.theme.deleteTenantIcon(
      { tenant: { tenantId: normalizedTenantId } },
      withSessionHeaders(sessionId)
    );

    return {
      icon: toTenantBrandingImage(
        response.theme?.iconImageUpdatedAt,
        response.theme?.iconImageVariants
      ),
      ok: true,
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: parseIconErrorMessage(error, genericIconDeleteErrorMessage),
      ok: false,
    };
  }
};

export const uploadTenantLogo = async (
  input: UploadTenantLogoInput
): Promise<TenantLogoResult> => {
  const sessionId = await getAccessToken();
  const normalizedTenantId = input.tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return { message: sessionErrorMessage, ok: false };
  }

  try {
    const response = await apiClient.theme.uploadTenantLogo(
      {
        logoContentType: input.logoContentType,
        logoData: input.logoData,
        tenant: { tenantId: normalizedTenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      logo: toTenantBrandingImage(
        response.theme?.logoImageUpdatedAt,
        response.theme?.logoImageVariants
      ),
      ok: true,
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: parseLogoErrorMessage(error, genericLogoUploadErrorMessage),
      ok: false,
    };
  }
};

export const deleteTenantLogo = async (
  tenantId: string
): Promise<TenantLogoResult> => {
  const sessionId = await getAccessToken();
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return { message: sessionErrorMessage, ok: false };
  }

  try {
    const response = await apiClient.theme.deleteTenantLogo(
      { tenant: { tenantId: normalizedTenantId } },
      withSessionHeaders(sessionId)
    );

    return {
      logo: toTenantBrandingImage(
        response.theme?.logoImageUpdatedAt,
        response.theme?.logoImageVariants
      ),
      ok: true,
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: parseLogoErrorMessage(error, genericLogoDeleteErrorMessage),
      ok: false,
    };
  }
};
