"use server";

import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { updateNotificationSettings } from "#lib/auth";
import { tenantIdFormSchema } from "#lib/auth-input";
import {
  requirePublicSession,
  withPublicSessionReauth,
} from "#lib/auth-session";

const NOTIFICATION_SETTINGS_RETURN_TO = "/settings/notifications";

const buildSettingsPath = (status: "success" | "error", message: string) => {
  const params = new URLSearchParams({ message, status });
  return `/settings/notifications?${params.toString()}`;
};

const updateNotificationSettingsFormSchema = z.object({
  emailNotificationsEnabled: z
    .literal("on", { error: "通知設定の値が不正です。" })
    .optional()
    .transform((value) => value === "on"),
  tenantId: tenantIdFormSchema,
});

export const updateNotificationSettingsAction = async (
  formData: FormData
): Promise<void> => {
  const parsed = updateNotificationSettingsFormSchema.safeParse(
    toFormDataInput(formData, {
      emailNotificationsEnabled: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    redirect(buildSettingsPath("error", toFormErrorMessage(parsed.error)));
  }

  const { emailNotificationsEnabled, tenantId } = parsed.data;
  const accessToken = await requirePublicSession(
    NOTIFICATION_SETTINGS_RETURN_TO
  );
  const updated = await withPublicSessionReauth(
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
        "error",
        "通知設定の更新に失敗しました。時間をおいて再度お試しください。"
      )
    );
  }

  redirect(buildSettingsPath("success", "通知設定を更新しました。"));
};
