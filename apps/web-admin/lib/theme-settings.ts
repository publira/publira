import type { TenantThemePalette } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorDisposition,
  rpcErrorRawMessage,
} from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import {
  DEFAULT_TENANT_THEME_COLORS,
  resolveTenantThemeColors,
} from "@publira/utils/theme-css-variables";
import type {
  TenantTheme,
  TenantThemeColors,
} from "@publira/utils/theme-css-variables";
import { cacheTag } from "next/cache";

import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import type { CachedRead } from "./cached-read";
import { settleCachedRead } from "./cached-read";
import {
  mentionsIconRejection,
  mentionsLogoRejection,
  mentionsSignInImageRejection,
  mentionsStorageNotConfigured,
} from "./image-rejection";
import { getMessagesFor } from "./messages";
import { getAccessToken } from "./session";
import { toTenantBrandingImage } from "./tenant-branding-image";
import type { TenantBrandingImage } from "./tenant-branding-image";

export interface UpdateTenantThemeSettingsInput extends TenantTheme {
  tenantId: string;
}

export type TenantThemeSettingsResult =
  | {
      ok: true;
      theme: TenantTheme;
      icon: TenantBrandingImage | null;
      logo: TenantBrandingImage | null;
      signInImage: TenantBrandingImage | null;
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

export interface UpdateTenantDarkThemeSettingsInput extends TenantThemeColors {
  tenantId: string;
}

export type TenantDarkThemeSettingsResult =
  | {
      ok: true;
      /** `null` while the tenant has saved no dark palette. */
      darkTheme: TenantThemeColors | null;
    }
  | {
      ok: false;
      message: string;
      /** As {@link TenantThemeSettingsResult}'s: only the read sets it. */
      requiresSignIn?: boolean;
    };

export type TenantIconResult =
  | { ok: true; icon: TenantBrandingImage | null }
  | { ok: false; message: string };

export type TenantLogoResult =
  | { ok: true; logo: TenantBrandingImage | null }
  | { ok: false; message: string };

export type TenantSignInImageResult =
  | { ok: true; signInImage: TenantBrandingImage | null }
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

export interface UploadTenantSignInImageInput {
  tenantId: string;
  imageContentType: string;
  imageData: Uint8Array;
}

/**
 * Tag the branding screen's cached read carries, so `updateTag` in a Server
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
      precondition: serverMessage,
    },
  });
};

/**
 * The icon rejections are worded here rather than taken from the server: the
 * handler answers in English, and the two cases it rejects — a source smaller
 * than 32px and an image it cannot decode — are already covered by one sentence
 * naming what the screen accepts. The `icon_data` field violation is what
 * separates a rejected image from any other `invalid_argument`.
 */
const parseIconErrorMessage = async (
  error: unknown,
  fallback: string,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);

  return rpcErrorMessage(error, fallback, {
    locale,
    overrides: {
      "invalid-argument": mentionsIconRejection(error)
        ? t("admin.settings.icon.rejected")
        : undefined,
      precondition: mentionsStorageNotConfigured(error)
        ? t("admin.errors.storage_not_configured")
        : undefined,
    },
  });
};

/** The logo rejections are worded here for the same reason as the icon's. */
const parseLogoErrorMessage = async (
  error: unknown,
  fallback: string,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);

  return rpcErrorMessage(error, fallback, {
    locale,
    overrides: {
      "invalid-argument": mentionsLogoRejection(error)
        ? t("admin.settings.logo.rejected")
        : undefined,
      precondition: mentionsStorageNotConfigured(error)
        ? t("admin.errors.storage_not_configured")
        : undefined,
    },
  });
};

/** The sign-in image rejections are worded here for the same reason. */
const parseSignInImageErrorMessage = async (
  error: unknown,
  fallback: string,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);

  return rpcErrorMessage(error, fallback, {
    locale,
    overrides: {
      "invalid-argument": mentionsSignInImageRejection(error)
        ? t("admin.settings.sign_in_image.rejected")
        : undefined,
      precondition: mentionsStorageNotConfigured(error)
        ? t("admin.errors.storage_not_configured")
        : undefined,
    },
  });
};

const toTenantTheme = (theme?: Partial<TenantTheme> | null): TenantTheme =>
  resolveTenantThemeColors(theme);

const toTenantThemeColors = (
  palette?: Pick<TenantThemePalette, keyof TenantThemeColors> | null
): TenantThemeColors | null => {
  if (!palette) {
    return null;
  }

  const theme = resolveTenantThemeColors(palette);
  const colors = { ...DEFAULT_TENANT_THEME_COLORS };
  for (const key of Object.keys(
    DEFAULT_TENANT_THEME_COLORS
  ) as (keyof TenantThemeColors)[]) {
    colors[key] = theme[key];
  }
  return colors;
};

const getTenantThemeSettingsForSession = async (
  tenantId: string,
  locale: Locale,
  sessionId: string
): Promise<CachedRead<TenantThemeSettingsResult>> => {
  "use cache: private";

  cacheTag(tenantThemeCacheTag(tenantId));

  const t = await getMessagesFor(locale);
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    dropFailedCacheEntry();
    return {
      message: t("errors.rpc.unauthenticated"),
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
      signInImage: toTenantBrandingImage(
        response.theme?.signInImageUpdatedAt,
        response.theme?.signInImageVariants
      ),
      theme: toTenantTheme(response.theme),
    };
  } catch (error) {
    dropFailedCacheEntry();
    return {
      message: parseErrorMessage(
        error,
        t("admin.settings.theme.load_failed"),
        locale
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
      unexpected: rpcErrorDisposition(error) === "unexpected",
    };
  }
};

export const getTenantThemeSettings = async (
  tenantId: string,
  locale: Locale
): Promise<TenantThemeSettingsResult> =>
  settleCachedRead(
    await getTenantThemeSettingsForSession(
      tenantId,
      locale,
      await getAccessToken()
    )
  );

/**
 * Logo for the console chrome. An unset theme, a classified RPC failure, or
 * an unexpected throw all become `null` — the shell keeps the tenant-name
 * text instead of taking the layout down.
 */
export const getTenantThemeLogo = async (
  tenantId: string,
  locale: Locale
): Promise<TenantBrandingImage | null> => {
  try {
    const result = await getTenantThemeSettings(tenantId, locale);
    return result.ok ? result.logo : null;
  } catch {
    return null;
  }
};

export const updateTenantThemeSettings = async (
  input: UpdateTenantThemeSettingsInput,
  locale: Locale
): Promise<TenantThemeSettingsResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  const normalizedTenantId = input.tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
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
          sansFontFamily: input.sansFontFamily,
          secondaryColor: input.secondaryColor,
          secondaryForegroundColor: input.secondaryForegroundColor,
          serifFontFamily: input.serifFontFamily,
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
      signInImage: toTenantBrandingImage(
        response.theme?.signInImageUpdatedAt,
        response.theme?.signInImageVariants
      ),
      theme: toTenantTheme(response.theme),
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: parseErrorMessage(
        error,
        t("admin.settings.theme.save_failed"),
        locale
      ),
      ok: false,
    };
  }
};

/**
 * The read never throws, unlike the light palette's: a server of the release
 * before this console answers `GetTenantDarkTheme` with `unimplemented`, and the
 * branding screen has to keep the light palette, the images, and the marks
 * editable while only the dark palette is unavailable.
 */
const getTenantDarkThemeSettingsForSession = async (
  tenantId: string,
  locale: Locale,
  sessionId: string
): Promise<TenantDarkThemeSettingsResult> => {
  "use cache: private";

  cacheTag(tenantThemeCacheTag(tenantId));

  const t = await getMessagesFor(locale);
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    dropFailedCacheEntry();
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: !sessionId,
    };
  }

  try {
    const response = await apiClient.theme.getTenantDarkTheme(
      { tenant: { tenantId: normalizedTenantId } },
      withSessionHeaders(sessionId)
    );

    return { darkTheme: toTenantThemeColors(response.darkTheme), ok: true };
  } catch (error) {
    dropFailedCacheEntry();
    return {
      message: parseErrorMessage(
        error,
        t("admin.settings.theme.dark.load_failed"),
        locale
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

export const getTenantDarkThemeSettings = async (
  tenantId: string,
  locale: Locale
): Promise<TenantDarkThemeSettingsResult> =>
  getTenantDarkThemeSettingsForSession(
    tenantId,
    locale,
    await getAccessToken()
  );

export const updateTenantDarkThemeSettings = async (
  { tenantId, ...darkTheme }: UpdateTenantDarkThemeSettingsInput,
  locale: Locale
): Promise<TenantDarkThemeSettingsResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.theme.upsertTenantDarkTheme(
      { darkTheme, tenant: { tenantId: normalizedTenantId } },
      withSessionHeaders(sessionId)
    );

    return { darkTheme: toTenantThemeColors(response.darkTheme), ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: parseErrorMessage(
        error,
        t("admin.settings.theme.dark.save_failed"),
        locale
      ),
      ok: false,
    };
  }
};

export const deleteTenantDarkThemeSettings = async (
  tenantId: string,
  locale: Locale
): Promise<TenantDarkThemeSettingsResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    await apiClient.theme.deleteTenantDarkTheme(
      { tenant: { tenantId: normalizedTenantId } },
      withSessionHeaders(sessionId)
    );

    return { darkTheme: null, ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: parseErrorMessage(
        error,
        t("admin.settings.theme.dark.delete_failed"),
        locale
      ),
      ok: false,
    };
  }
};

export const uploadTenantIcon = async (
  input: UploadTenantIconInput,
  locale: Locale
): Promise<TenantIconResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  const normalizedTenantId = input.tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
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
      message: await parseIconErrorMessage(
        error,
        t("admin.settings.icon.upload_failed"),
        locale
      ),
      ok: false,
    };
  }
};

export const deleteTenantIcon = async (
  tenantId: string,
  locale: Locale
): Promise<TenantIconResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
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
      message: await parseIconErrorMessage(
        error,
        t("admin.settings.icon.delete_failed"),
        locale
      ),
      ok: false,
    };
  }
};

export const uploadTenantLogo = async (
  input: UploadTenantLogoInput,
  locale: Locale
): Promise<TenantLogoResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  const normalizedTenantId = input.tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
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
      message: await parseLogoErrorMessage(
        error,
        t("admin.settings.logo.upload_failed"),
        locale
      ),
      ok: false,
    };
  }
};

export const deleteTenantLogo = async (
  tenantId: string,
  locale: Locale
): Promise<TenantLogoResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
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
      message: await parseLogoErrorMessage(
        error,
        t("admin.settings.logo.delete_failed"),
        locale
      ),
      ok: false,
    };
  }
};

export const uploadTenantSignInImage = async (
  input: UploadTenantSignInImageInput,
  locale: Locale
): Promise<TenantSignInImageResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  const normalizedTenantId = input.tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.theme.uploadTenantSignInImage(
      {
        imageContentType: input.imageContentType,
        imageData: input.imageData,
        tenant: { tenantId: normalizedTenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      ok: true,
      signInImage: toTenantBrandingImage(
        response.theme?.signInImageUpdatedAt,
        response.theme?.signInImageVariants
      ),
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: await parseSignInImageErrorMessage(
        error,
        t("admin.settings.sign_in_image.upload_failed"),
        locale
      ),
      ok: false,
    };
  }
};

export const deleteTenantSignInImage = async (
  tenantId: string,
  locale: Locale
): Promise<TenantSignInImageResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.theme.deleteTenantSignInImage(
      { tenant: { tenantId: normalizedTenantId } },
      withSessionHeaders(sessionId)
    );

    return {
      ok: true,
      signInImage: toTenantBrandingImage(
        response.theme?.signInImageUpdatedAt,
        response.theme?.signInImageVariants
      ),
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: await parseSignInImageErrorMessage(
        error,
        t("admin.settings.sign_in_image.delete_failed"),
        locale
      ),
      ok: false,
    };
  }
};
