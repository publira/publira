import { resolveTenantThemeColors } from "@publira/utils/theme-css-variables";
import type { TenantThemeColors } from "@publira/utils/theme-css-variables";

import { apiClient, withSessionHeaders } from "./api";
import { getAccessToken } from "./session";

export type TenantThemeSettings = TenantThemeColors;

export interface UpdateTenantThemeSettingsInput extends TenantThemeSettings {
  tenantId: string;
}

export type TenantThemeSettingsResult =
  | { ok: true; theme: TenantThemeSettings }
  | { ok: false; message: string };

const genericLoadErrorMessage =
  "テーマの取得に失敗しました。時間をおいて再試行してください。";
const genericUpdateErrorMessage =
  "テーマの保存に失敗しました。時間をおいて再試行してください。";
const sessionErrorMessage = "セッションが無効です。再ログインしてください。";

const parseErrorMessage = (error: unknown, fallback: string): string => {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const message = error.message.trim();
  if (!message) {
    return fallback;
  }

  const lower = message.toLowerCase();
  if (
    lower.includes("unauthenticated") ||
    lower.includes("permission_denied")
  ) {
    return sessionErrorMessage;
  }

  const prefixes = ["invalid_argument:", "failed_precondition:"] as const;
  for (const prefix of prefixes) {
    if (lower.startsWith(prefix)) {
      return message.slice(prefix.length).trim() || fallback;
    }
  }

  return fallback;
};

const toTenantTheme = (
  theme?: Partial<TenantThemeSettings> | null
): TenantThemeSettings => resolveTenantThemeColors(theme);

export const getTenantThemeSettings = async (
  tenantId: string
): Promise<TenantThemeSettingsResult> => {
  "use cache: private";

  const sessionId = await getAccessToken();
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return { message: sessionErrorMessage, ok: false };
  }

  try {
    const response = await apiClient.theme.getTenantTheme(
      {
        tenant: { tenantId: normalizedTenantId },
      },
      withSessionHeaders(sessionId)
    );

    return { ok: true, theme: toTenantTheme(response.theme) };
  } catch (error) {
    return {
      message: parseErrorMessage(error, genericLoadErrorMessage),
      ok: false,
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

    return { ok: true, theme: toTenantTheme(response.theme) };
  } catch (error) {
    return {
      message: parseErrorMessage(error, genericUpdateErrorMessage),
      ok: false,
    };
  }
};
