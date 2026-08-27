"use server";

import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { signupPublic } from "#lib/auth";
import {
  emailFormSchema,
  passwordFormSchema,
  tenantIdFormSchema,
} from "#lib/auth-input";
import { assertSameOrigin } from "#lib/csrf";
import {
  setEmailFlashCookie,
  SIGNUP_PENDING_EMAIL_COOKIE,
} from "#lib/email-flash-cookie";
import { localeFormSchema } from "#lib/locale-form";
import { withLocalePrefix } from "#lib/locale-path";

const signupFormSchema = z
  .object({
    confirmPassword: z
      .string({ error: "パスワード確認を入力してください。" })
      .min(1, "パスワード確認を入力してください。")
      .max(1024, "パスワード確認は1024文字以内で入力してください。"),
    email: emailFormSchema,
    locale: localeFormSchema,
    name: z
      .string({ error: "表示名を入力してください。" })
      .trim()
      .min(1, "表示名を入力してください。")
      .max(100, "表示名は100文字以内で入力してください。"),
    password: passwordFormSchema,
    tenantId: tenantIdFormSchema,
  })
  .refine((value) => value.password === value.confirmPassword, {
    error: "パスワード確認が一致しません。",
    path: ["confirmPassword"],
  });

export const signupAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const parsed = signupFormSchema.safeParse(
    toFormDataInput(formData, {
      confirmPassword: "value",
      email: "value",
      locale: "value",
      name: "value",
      password: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error),
      ok: false,
    };
  }

  const { email, locale, name, password, tenantId } = parsed.data;
  const result = await signupPublic(name, email, password, tenantId);
  if (!result) {
    return {
      message: "新規登録に失敗しました。入力内容をご確認ください。",
      ok: false,
    };
  }

  if (result.pendingVerification) {
    await setEmailFlashCookie(SIGNUP_PENDING_EMAIL_COOKIE, email);
    redirect(withLocalePrefix(locale, "/signup/pending"));
  }

  redirect(withLocalePrefix(locale, "/my"));
};
