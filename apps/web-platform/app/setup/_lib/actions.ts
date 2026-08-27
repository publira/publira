"use server";

import { getMessage } from "@publira/i18n";
import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { emailFormSchema, passwordFormSchema } from "#lib/auth-input";
import { assertSameOrigin } from "#lib/csrf";
import { requiredTrimmedString } from "#lib/form-schemas";
import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";
import type { PlatformMessages } from "#lib/locale";
import { createInitialUser } from "#lib/setup";

const setupFormSchema = (messages: PlatformMessages) =>
  z
    .object({
      confirmPassword: passwordFormSchema(messages),
      email: emailFormSchema(messages),
      name: requiredTrimmedString(
        getMessage(messages, "platform.auth.setup.name_required")
      ),
      password: passwordFormSchema(messages),
    })
    .refine((value) => value.password === value.confirmPassword, {
      error: getMessage(messages, "platform.auth.setup.password_mismatch"),
      path: ["confirmPassword"],
    });

export const setupAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  const parsed = setupFormSchema(messages).safeParse(
    toFormDataInput(formData, {
      confirmPassword: "value",
      email: "value",
      name: "value",
      password: "value",
    })
  );
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, { locale }),
      ok: false,
    };
  }

  const { email, name, password } = parsed.data;
  const result = await createInitialUser(name, email, password, locale);
  if (!result.ok) {
    if (result.alreadyCompleted) {
      redirect("/login");
    }
    return { message: result.message, ok: false };
  }

  redirect("/login?setup=done");
};
