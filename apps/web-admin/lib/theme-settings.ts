import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorRawMessage,
} from "@publira/api-client/errors";
import { resolveTenantThemeColors } from "@publira/utils/theme-css-variables";
import type { TenantThemeColors } from "@publira/utils/theme-css-variables";

import { apiClient, withSessionHeaders } from "./api";
import { getAccessToken } from "./session";

export interface UpdateTenantThemeSettingsInput extends TenantThemeColors {
  tenantId: string;
}

export type TenantThemeSettingsResult =
  | { ok: true; theme: TenantThemeColors }
  | { ok: false; message: string };

const genericLoadErrorMessage =
  "テーマの取得に失敗しました。時間をおいて再試行してください。";
const genericUpdateErrorMessage =
  "テーマの保存に失敗しました。時間をおいて再試行してください。";
const sessionErrorMessage = "セッションが無効です。再ログインしてください。";

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

const toTenantTheme = (
  theme?: Partial<TenantThemeColors> | null
): TenantThemeColors => resolveTenantThemeColors(theme);

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
    rethrowUnclassifiedRpcError(error);
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
    rethrowUnclassifiedRpcError(error);
    return {
      message: parseErrorMessage(error, genericUpdateErrorMessage),
      ok: false,
    };
  }
};
