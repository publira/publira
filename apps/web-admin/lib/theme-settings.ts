import { apiClient, withSessionHeaders } from "./api";
import { getAccessToken } from "./session";

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
  tenantId: string;
}

export type TenantThemeSettingsResult =
  | { ok: true; theme: TenantThemeSettings }
  | { ok: false; message: string };

const defaultTheme: TenantThemeSettings = {
  accentColor: "#7aae90",
  accentForegroundColor: "#0f2a1f",
  backgroundColor: "#f6f2e9",
  borderColor: "#d7ccba",
  cardColor: "#fffdf8",
  cardForegroundColor: "#1e2b38",
  destructiveColor: "#b54444",
  destructiveForegroundColor: "#fff4f4",
  foregroundColor: "#1e2b38",
  infoColor: "#3c78c2",
  infoForegroundColor: "#f3f8ff",
  inputColor: "#e3d8c7",
  mutedColor: "#e9e1d3",
  mutedForegroundColor: "#5c6773",
  popoverColor: "#fffdf8",
  popoverForegroundColor: "#1e2b38",
  primaryColor: "#0f7c82",
  primaryForegroundColor: "#f4fbfb",
  ringColor: "#2d8d93",
  secondaryColor: "#d96f4a",
  secondaryForegroundColor: "#fff6f1",
  successColor: "#2f8f5b",
  successForegroundColor: "#f3fcf7",
  surfaceColor: "#fbf8f2",
  surfaceForegroundColor: "#1e2b38",
  warningColor: "#c4872a",
  warningForegroundColor: "#fff8ea",
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

const toTenantTheme = (
  theme?: Partial<TenantThemeSettings>
): TenantThemeSettings => {
  const source: Partial<TenantThemeSettings> = theme ?? {};
  return Object.fromEntries(
    Object.entries(defaultTheme).map(([key, fallback]) => {
      const sourceValue = source[key as keyof TenantThemeSettings];
      return [key, sourceValue || fallback];
    })
  ) as TenantThemeSettings;
};

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
