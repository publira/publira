"use server";

import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { emailFormSchema, passwordFormSchema } from "#lib/auth-input";
import { requiredTrimmedString } from "#lib/form-schemas";
import { createInitialUser } from "#lib/setup";

const setupFormSchema = z
  .object({
    confirmPassword: passwordFormSchema,
    email: emailFormSchema,
    name: requiredTrimmedString("すべての項目を入力してください。"),
    password: passwordFormSchema,
  })
  .refine((value) => value.password === value.confirmPassword, {
    error: "パスワードと確認用パスワードが一致しません。",
    path: ["confirmPassword"],
  });

export const setupAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  const parsed = setupFormSchema.safeParse(
    toFormDataInput(formData, {
      confirmPassword: "value",
      email: "value",
      name: "value",
      password: "value",
    })
  );
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error),
      ok: false,
    };
  }

  const { email, name, password } = parsed.data;
  const result = await createInitialUser(name, email, password);
  if (!result.ok) {
    if (result.alreadyCompleted) {
      redirect("/login");
    }
    return { message: result.message, ok: false };
  }

  redirect("/login?setup=done");
};
