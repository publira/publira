"use server";

import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { signupPublic } from "#lib/auth";
import { tenantIdFormSchema } from "#lib/auth-input";

const REQUIRED_FIELDS_MESSAGE = "名前・メールアドレス・パスワードは必須です。";

const signupFormSchema = z
  .object({
    confirmPassword: z.string().max(1024),
    email: z
      .string({ error: REQUIRED_FIELDS_MESSAGE })
      .trim()
      .min(1, REQUIRED_FIELDS_MESSAGE)
      .pipe(z.email("メールアドレスの形式が正しくありません。")),
    name: z
      .string({ error: REQUIRED_FIELDS_MESSAGE })
      .trim()
      .min(1, REQUIRED_FIELDS_MESSAGE)
      .max(100, "表示名は100文字以内で入力してください。"),
    password: z
      .string({ error: REQUIRED_FIELDS_MESSAGE })
      .min(1, REQUIRED_FIELDS_MESSAGE)
      .max(1024),
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
  const parsed = signupFormSchema.safeParse(
    toFormDataInput(formData, {
      confirmPassword: "value",
      email: "value",
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

  const { email, name, password, tenantId } = parsed.data;
  const result = await signupPublic(name, email, password, tenantId);
  if (!result) {
    return {
      message: "新規登録に失敗しました。入力内容をご確認ください。",
      ok: false,
    };
  }

  if (result.pendingVerification) {
    const params = new URLSearchParams({ email });
    redirect(`/signup/pending?${params.toString()}`);
  }

  redirect("/my");
};
