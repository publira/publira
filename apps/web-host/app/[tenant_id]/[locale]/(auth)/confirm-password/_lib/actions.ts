"use server";

import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { parseLocale } from "@publira/utils/i18n";
import type { Locale } from "@publira/utils/i18n";
import { redirect } from "next/navigation";
import { z } from "zod";

import { confirmPublicPasswordReset } from "#lib/auth";
import {
  authTokenFormSchema,
  passwordFormSchema,
  tenantIdFormSchema,
} from "#lib/auth-input";
import { localeFormSchema } from "#lib/locale-form";
import { withLocalePrefix } from "#lib/locale-path";

const tokenOrEmpty = (value: string | undefined): string => {
  const parsed = authTokenFormSchema.safeParse(value);
  return parsed.success ? parsed.data : "";
};

const confirmPasswordFormSchema = z
  .object({
    confirmPassword: passwordFormSchema,
    locale: localeFormSchema,
    newPassword: passwordFormSchema,
    tenantId: tenantIdFormSchema,
    token: authTokenFormSchema,
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    error: "パスワード確認が一致しません。",
    path: ["confirmPassword"],
  });

const buildConfirmPasswordErrorPath = (
  locale: Locale,
  token: string,
  message: string
): string => {
  const params = new URLSearchParams({
    error: message,
    token,
  });
  const path = withLocalePrefix(locale, "/confirm-password");
  return `${path}?${params.toString()}`;
};

const buildLoginPathWithResetResult = (locale: Locale): string => {
  const params = new URLSearchParams({ reset: "done" });
  return `${withLocalePrefix(locale, "/login")}?${params.toString()}`;
};

export const confirmPasswordAction = async (
  formData: FormData
): Promise<void> => {
  const input = toFormDataInput(formData, {
    confirmPassword: "value",
    locale: "value",
    newPassword: "value",
    tenantId: "value",
    token: "value",
  });
  const parsed = confirmPasswordFormSchema.safeParse(input);
  if (!parsed.success) {
    const token = tokenOrEmpty(input.token);
    redirect(
      buildConfirmPasswordErrorPath(
        parseLocale(input.locale),
        token,
        toFormErrorMessage(parsed.error)
      )
    );
  }

  const { locale, newPassword, tenantId, token } = parsed.data;
  const confirmed = await confirmPublicPasswordReset(
    token,
    newPassword,
    tenantId
  );
  if (!confirmed) {
    redirect(
      buildConfirmPasswordErrorPath(
        locale,
        token,
        "再設定に失敗しました。リンクの有効期限切れ、または無効なリンクの可能性があります。"
      )
    );
  }

  redirect(buildLoginPathWithResetResult(locale));
};
