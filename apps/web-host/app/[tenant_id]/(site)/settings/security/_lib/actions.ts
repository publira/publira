"use server";

import {
  toFormErrorMessage,
  VALIDATION_ERROR_MESSAGE,
} from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requestPublicEmailChange } from "#lib/auth";
import {
  emailFormSchema,
  passwordFormSchema,
  tenantIdFormSchema,
} from "#lib/auth-input";

const buildSettingsPath = (status: "success" | "error", message: string) => {
  const params = new URLSearchParams({ message, status });
  return `/settings/security?${params.toString()}`;
};

const requestEmailChangeFormSchema = z.object({
  currentEmail: emailFormSchema,
  currentPassword: passwordFormSchema,
  newEmail: emailFormSchema,
  tenantId: tenantIdFormSchema,
});

export const requestEmailChangeAction = async (
  formData: FormData
): Promise<void> => {
  const parsed = requestEmailChangeFormSchema.safeParse(
    toFormDataInput(formData, {
      currentEmail: "value",
      currentPassword: "value",
      newEmail: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    redirect(
      buildSettingsPath(
        "error",
        toFormErrorMessage(parsed.error, {
          fallback: VALIDATION_ERROR_MESSAGE,
        })
      )
    );
  }

  const { currentEmail, currentPassword, newEmail, tenantId } = parsed.data;
  const requested = await requestPublicEmailChange(
    tenantId,
    currentEmail,
    newEmail,
    currentPassword
  );
  if (!requested) {
    redirect(
      buildSettingsPath(
        "error",
        "メール変更リクエストに失敗しました。入力内容をご確認ください。"
      )
    );
  }

  redirect(
    buildSettingsPath(
      "success",
      "現在のメールアドレスと新しいメールアドレスの両方に確認メールを送信しました。両方のリンクを開いて変更を完了してください。"
    )
  );
};
