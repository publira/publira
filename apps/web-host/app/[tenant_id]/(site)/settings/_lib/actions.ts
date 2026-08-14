"use server";

import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { updateMe } from "#lib/auth";
import { tenantIdFormSchema } from "#lib/auth-input";

import { buildSettingsPath } from "./settings-form";

const updateProfileFormSchema = z.object({
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
      name: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    redirect(buildSettingsPath("error", toFormErrorMessage(parsed.error)));
  }

  const { name, tenantId } = parsed.data;
  const updated = await updateMe(tenantId, name);
  if (!updated) {
    redirect(
      buildSettingsPath(
        "error",
        "プロフィールの更新に失敗しました。時間をおいて再度お試しください。"
      )
    );
  }

  redirect(buildSettingsPath("success", "プロフィールを更新しました。"));
};
