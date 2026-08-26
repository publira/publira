"use server";

import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { parseLocale } from "@publira/utils/i18n";
import type { Locale } from "@publira/utils/i18n";
import { redirect } from "next/navigation";
import { z } from "zod";

import { updateNotificationSettings } from "#lib/auth";
import { tenantIdFormSchema } from "#lib/auth-input";
import {
  requirePublicSession,
  withPublicSessionReauth,
} from "#lib/auth-session";
import { localeFormSchema } from "#lib/locale-form";
import { withLocalePrefix } from "#lib/locale-path";

const NOTIFICATION_SETTINGS_RETURN_TO = "/settings/notifications";

const buildSettingsPath = (
  locale: Locale,
  status: "success" | "error",
  message: string
) => {
  const params = new URLSearchParams({ message, status });
  const path = withLocalePrefix(locale, NOTIFICATION_SETTINGS_RETURN_TO);
  return `${path}?${params.toString()}`;
};

const updateNotificationSettingsFormSchema = z.object({
  emailNotificationsEnabled: z
    .literal("on", { error: "通知設定の値が不正です。" })
    .optional()
    .transform((value) => value === "on"),
  locale: localeFormSchema,
  tenantId: tenantIdFormSchema,
});

export const updateNotificationSettingsAction = async (
  formData: FormData
): Promise<void> => {
  const parsed = updateNotificationSettingsFormSchema.safeParse(
    toFormDataInput(formData, {
      emailNotificationsEnabled: "value",
      locale: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    redirect(
      buildSettingsPath(
        parseLocale(formData.get("locale")),
        "error",
        toFormErrorMessage(parsed.error)
      )
    );
  }

  const { emailNotificationsEnabled, locale, tenantId } = parsed.data;
  const accessToken = await requirePublicSession(
    locale,
    NOTIFICATION_SETTINGS_RETURN_TO
  );
  const updated = await withPublicSessionReauth(
    locale,
    NOTIFICATION_SETTINGS_RETURN_TO,
    () =>
      updateNotificationSettings(
        tenantId,
        emailNotificationsEnabled,
        accessToken
      )
  );
  if (!updated) {
    redirect(
      buildSettingsPath(
        locale,
        "error",
        "通知設定の更新に失敗しました。時間をおいて再度お試しください。"
      )
    );
  }

  redirect(buildSettingsPath(locale, "success", "通知設定を更新しました。"));
};
