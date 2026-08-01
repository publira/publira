import { apiClient, withSessionHeaders } from "./api";
import { getAccessToken } from "./session";

export interface TenantSiteSettings {
  copyrightText: string;
  siteDescription: string;
  siteTagline: string;
}

export type GetTenantSiteSettingsResult =
  | { ok: true; settings: TenantSiteSettings }
  | { ok: false; message: string; settings: TenantSiteSettings };

export type UpdateTenantSiteSettingsResult =
  | { ok: true; settings: TenantSiteSettings }
  | { ok: false; message: string };

const defaultSettings: TenantSiteSettings = {
  copyrightText: "",
  siteDescription: "",
  siteTagline: "",
};

const genericLoadErrorMessage =
  "設定の取得に失敗しました。時間をおいて再試行してください。";
const genericUpdateErrorMessage =
  "設定の保存に失敗しました。時間をおいて再試行してください。";

const mapErrorToMessage = (error: unknown, fallbackMessage: string): string => {
  if (!(error instanceof Error)) {
    return fallbackMessage;
  }

  const message = error.message.toLowerCase();

  if (
    message.includes("unauthenticated") ||
    message.includes("permission_denied")
  ) {
    return "セッションが無効です。再ログインしてください。";
  }

  return fallbackMessage;
};

export const getTenantSiteSettings = async (
  tenantId: string
): Promise<GetTenantSiteSettingsResult> => {
  "use cache: private";

  const sessionId = await getAccessToken();
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
      settings: defaultSettings,
    };
  }

  try {
    const response = await apiClient.auth.getTenantConfig(
      {
        tenant: { tenantId: normalizedTenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      ok: true,
      settings: {
        copyrightText: response.copyrightText ?? "",
        siteDescription: response.siteDescription ?? "",
        siteTagline: response.siteTagline ?? "",
      },
    };
  } catch (error) {
    return {
      message: mapErrorToMessage(error, genericLoadErrorMessage),
      ok: false,
      settings: defaultSettings,
    };
  }
};

export const updateTenantSiteSettings = async (input: {
  tenantId: string;
  copyrightText: string;
  siteDescription: string;
  siteTagline: string;
}): Promise<UpdateTenantSiteSettingsResult> => {
  const sessionId = await getAccessToken();
  const normalizedTenantId = input.tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }

  try {
    const response = await apiClient.auth.updateTenantConfig(
      {
        copyrightText: input.copyrightText,
        siteDescription: input.siteDescription,
        siteTagline: input.siteTagline,
        tenant: { tenantId: normalizedTenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      ok: true,
      settings: {
        copyrightText: response.copyrightText ?? "",
        siteDescription: response.siteDescription ?? "",
        siteTagline: response.siteTagline ?? "",
      },
    };
  } catch (error) {
    return {
      message: mapErrorToMessage(error, genericUpdateErrorMessage),
      ok: false,
    };
  }
};
