"use server";

import { parseLocale } from "@publira/i18n";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { updateMe } from "#lib/auth";
import { tenantIdFormSchema } from "#lib/auth-input";
import {
  requirePublicSession,
  withPublicSessionReauth,
} from "#lib/auth-session";
import { localeFormSchema } from "#lib/locale-form";

import { buildSettingsPath } from "./settings-form";

const SETTINGS_RETURN_TO = "/settings";

const updateProfileFormSchema = z.object({
  locale: localeFormSchema,
  name: z
    .string({ error: "表示名を入力してください。" })
    .trim()
    .min(1, "表示名を入力してください。")
    .max(100, "表示名は100文字以内で入力してください。"),
  tenantId: tenantIdFormSchema,
});

export const updateProfileAction = async (
  formData: FormData
): Promise<void> => {
  const parsed = updateProfileFormSchema.safeParse(
    toFormDataInput(formData, {
      locale: "value",
      name: "value",
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

  const { locale, name, tenantId } = parsed.data;
  const accessToken = await requirePublicSession(locale, SETTINGS_RETURN_TO);
  const updated = await withPublicSessionReauth(
    locale,
    SETTINGS_RETURN_TO,
    () => updateMe(tenantId, name, accessToken)
  );
  if (!updated) {
    redirect(
      buildSettingsPath(
        locale,
        "error",
        "プロフィールの更新に失敗しました。時間をおいて再度お試しください。"
      )
    );
  }

  redirect(
    buildSettingsPath(locale, "success", "プロフィールを更新しました。")
  );
};
