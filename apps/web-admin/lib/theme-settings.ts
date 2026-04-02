import { apiClient, withSessionHeaders } from "./api";
import { getSessionId } from "./session";

export interface TenantThemeSettings {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundColor: string;
  foregroundColor: string;
  surfaceColor: string;
  surfaceForegroundColor: string;
  cardColor: string;
  cardForegroundColor: string;
  popoverColor: string;
  popoverForegroundColor: string;
  primaryForegroundColor: string;
  secondaryForegroundColor: string;
  accentForegroundColor: string;
  mutedColor: string;
  mutedForegroundColor: string;
  borderColor: string;
  inputColor: string;
  ringColor: string;
  successColor: string;
  successForegroundColor: string;
  warningColor: string;
  warningForegroundColor: string;
  destructiveColor: string;
  destructiveForegroundColor: string;
  infoColor: string;
  infoForegroundColor: string;
}

export interface UpdateTenantThemeSettingsInput extends TenantThemeSettings {
  tenantPublicId: string;
}

export type TenantThemeSettingsResult =
  | { ok: true; theme: TenantThemeSettings }
  | { ok: false; message: string };

const defaultTheme: TenantThemeSettings = {
  primaryColor: "#0f7c82",
  secondaryColor: "#d96f4a",
  accentColor: "#7aae90",
  backgroundColor: "#f6f2e9",
  foregroundColor: "#1e2b38",
  surfaceColor: "#fbf8f2",
  surfaceForegroundColor: "#1e2b38",
  cardColor: "#fffdf8",
  cardForegroundColor: "#1e2b38",
  popoverColor: "#fffdf8",
  popoverForegroundColor: "#1e2b38",
  primaryForegroundColor: "#f4fbfb",
  secondaryForegroundColor: "#fff6f1",
  accentForegroundColor: "#0f2a1f",
  mutedColor: "#e9e1d3",
  mutedForegroundColor: "#5c6773",
  borderColor: "#d7ccba",
  inputColor: "#e3d8c7",
  ringColor: "#2d8d93",
  successColor: "#2f8f5b",
  successForegroundColor: "#f3fcf7",
  warningColor: "#c4872a",
  warningForegroundColor: "#fff8ea",
  destructiveColor: "#b54444",
  destructiveForegroundColor: "#fff4f4",
  infoColor: "#3c78c2",
  infoForegroundColor: "#f3f8ff",
};

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

const toTenantTheme = (theme?: {
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  backgroundColor?: string;
  foregroundColor?: string;
  surfaceColor?: string;
  surfaceForegroundColor?: string;
  cardColor?: string;
  cardForegroundColor?: string;
  popoverColor?: string;
  popoverForegroundColor?: string;
  primaryForegroundColor?: string;
  secondaryForegroundColor?: string;
  accentForegroundColor?: string;
  mutedColor?: string;
  mutedForegroundColor?: string;
  borderColor?: string;
  inputColor?: string;
  ringColor?: string;
  successColor?: string;
  successForegroundColor?: string;
  warningColor?: string;
  warningForegroundColor?: string;
  destructiveColor?: string;
  destructiveForegroundColor?: string;
  infoColor?: string;
  infoForegroundColor?: string;
}): TenantThemeSettings => ({
  primaryColor: theme?.primaryColor || defaultTheme.primaryColor,
  secondaryColor: theme?.secondaryColor || defaultTheme.secondaryColor,
  accentColor: theme?.accentColor || defaultTheme.accentColor,
  backgroundColor: theme?.backgroundColor || defaultTheme.backgroundColor,
  foregroundColor: theme?.foregroundColor || defaultTheme.foregroundColor,
  surfaceColor: theme?.surfaceColor || defaultTheme.surfaceColor,
  surfaceForegroundColor: theme?.surfaceForegroundColor || defaultTheme.surfaceForegroundColor,
  cardColor: theme?.cardColor || defaultTheme.cardColor,
  cardForegroundColor: theme?.cardForegroundColor || defaultTheme.cardForegroundColor,
  popoverColor: theme?.popoverColor || defaultTheme.popoverColor,
  popoverForegroundColor: theme?.popoverForegroundColor || defaultTheme.popoverForegroundColor,
  primaryForegroundColor: theme?.primaryForegroundColor || defaultTheme.primaryForegroundColor,
  secondaryForegroundColor: theme?.secondaryForegroundColor || defaultTheme.secondaryForegroundColor,
  accentForegroundColor: theme?.accentForegroundColor || defaultTheme.accentForegroundColor,
  mutedColor: theme?.mutedColor || defaultTheme.mutedColor,
  mutedForegroundColor: theme?.mutedForegroundColor || defaultTheme.mutedForegroundColor,
  borderColor: theme?.borderColor || defaultTheme.borderColor,
  inputColor: theme?.inputColor || defaultTheme.inputColor,
  ringColor: theme?.ringColor || defaultTheme.ringColor,
  successColor: theme?.successColor || defaultTheme.successColor,
  successForegroundColor: theme?.successForegroundColor || defaultTheme.successForegroundColor,
  warningColor: theme?.warningColor || defaultTheme.warningColor,
  warningForegroundColor: theme?.warningForegroundColor || defaultTheme.warningForegroundColor,
  destructiveColor: theme?.destructiveColor || defaultTheme.destructiveColor,
  destructiveForegroundColor: theme?.destructiveForegroundColor || defaultTheme.destructiveForegroundColor,
  infoColor: theme?.infoColor || defaultTheme.infoColor,
  infoForegroundColor: theme?.infoForegroundColor || defaultTheme.infoForegroundColor,
});

export const getTenantThemeSettings = async (
  tenantPublicId: string
): Promise<TenantThemeSettingsResult> => {
  "use cache: private";

  const sessionId = await getSessionId();
  const normalizedTenantPublicId = tenantPublicId.trim();
  if (!normalizedTenantPublicId || !sessionId) {
    return { message: sessionErrorMessage, ok: false };
  }

  try {
    const response = await apiClient.theme.getTenantTheme(
      {
        tenant: { tenantPublicId: normalizedTenantPublicId },
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
  const sessionId = await getSessionId();
  const normalizedTenantPublicId = input.tenantPublicId.trim();
  if (!normalizedTenantPublicId || !sessionId) {
    return { message: sessionErrorMessage, ok: false };
  }

  try {
    const response = await apiClient.theme.upsertTenantTheme(
      {
        tenant: { tenantPublicId: normalizedTenantPublicId },
        theme: {
          primaryColor: input.primaryColor,
          secondaryColor: input.secondaryColor,
          accentColor: input.accentColor,
          backgroundColor: input.backgroundColor,
          foregroundColor: input.foregroundColor,
          surfaceColor: input.surfaceColor,
          surfaceForegroundColor: input.surfaceForegroundColor,
          cardColor: input.cardColor,
          cardForegroundColor: input.cardForegroundColor,
          popoverColor: input.popoverColor,
          popoverForegroundColor: input.popoverForegroundColor,
          primaryForegroundColor: input.primaryForegroundColor,
          secondaryForegroundColor: input.secondaryForegroundColor,
          accentForegroundColor: input.accentForegroundColor,
          mutedColor: input.mutedColor,
          mutedForegroundColor: input.mutedForegroundColor,
          borderColor: input.borderColor,
          inputColor: input.inputColor,
          ringColor: input.ringColor,
          successColor: input.successColor,
          successForegroundColor: input.successForegroundColor,
          warningColor: input.warningColor,
          warningForegroundColor: input.warningForegroundColor,
          destructiveColor: input.destructiveColor,
          destructiveForegroundColor: input.destructiveForegroundColor,
          infoColor: input.infoColor,
          infoForegroundColor: input.infoForegroundColor,
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
