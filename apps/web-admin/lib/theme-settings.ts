import { apiClient, withSessionHeaders } from "./api";
import { getSessionId } from "./session";

export interface TenantThemeSettings {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
}

export interface UpdateTenantThemeSettingsInput extends TenantThemeSettings {
  tenantPublicId: string;
}

export type TenantThemeSettingsResult =
  | { ok: true; theme: TenantThemeSettings }
  | { ok: false; message: string };

const defaultTheme: TenantThemeSettings = {
  accentColor: "#2f8f5b",
  primaryColor: "#2d8d93",
  secondaryColor: "#c4872a",
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
}): TenantThemeSettings => ({
  accentColor: theme?.accentColor || defaultTheme.accentColor,
  primaryColor: theme?.primaryColor || defaultTheme.primaryColor,
  secondaryColor: theme?.secondaryColor || defaultTheme.secondaryColor,
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
          accentColor: input.accentColor,
          primaryColor: input.primaryColor,
          secondaryColor: input.secondaryColor,
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
