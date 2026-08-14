"use server";

import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { confirmPublicPasswordReset } from "#lib/auth";
import { authTokenFormSchema, tenantIdFormSchema } from "#lib/auth-input";

const tokenOrEmpty = (value: string | undefined): string => {
  const parsed = authTokenFormSchema.safeParse(value);
  return parsed.success ? parsed.data : "";
};

const NEW_PASSWORD_REQUIRED = "新しいパスワードを入力してください。";

const confirmPasswordFormSchema = z
  .object({
    confirmPassword: z.string().trim().max(1024),
    newPassword: z
      .string({ error: NEW_PASSWORD_REQUIRED })
      .trim()
      .min(1, NEW_PASSWORD_REQUIRED)
      .max(1024),
    tenantId: tenantIdFormSchema,
    token: authTokenFormSchema,
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    error: "パスワード確認が一致しません。",
    path: ["confirmPassword"],
  });

const buildConfirmPasswordErrorPath = (
  token: string,
  message: string
): string => {
  const params = new URLSearchParams({
    error: message,
    token,
  });
  return `/confirm-password?${params.toString()}`;
};

const buildLoginPathWithResetResult = (): string => {
  const params = new URLSearchParams({ reset: "done" });
  return `/login?${params.toString()}`;
};

export const confirmPasswordAction = async (
  formData: FormData
): Promise<void> => {
  const input = toFormDataInput(formData, {
    confirmPassword: "value",
    newPassword: "value",
    tenantId: "value",
    token: "value",
  });
  const parsed = confirmPasswordFormSchema.safeParse(input);
  if (!parsed.success) {
    const token = tokenOrEmpty(input.token);
    redirect(
      buildConfirmPasswordErrorPath(token, toFormErrorMessage(parsed.error))
    );
  }

  const { newPassword, tenantId, token } = parsed.data;
  const confirmed = await confirmPublicPasswordReset(
    token,
    newPassword,
    tenantId
  );
  if (!confirmed) {
    redirect(
      buildConfirmPasswordErrorPath(
        token,
        "再設定に失敗しました。リンクの有効期限切れ、または無効なリンクの可能性があります。"
      )
    );
  }

  redirect(buildLoginPathWithResetResult());
};
