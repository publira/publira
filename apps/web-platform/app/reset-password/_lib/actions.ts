"use server";

import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { emailFormSchema } from "#lib/auth-input";
import { assertSameOrigin } from "#lib/csrf";
import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";
import type { PlatformMessages } from "#lib/locale";
import { requestPlatformPasswordReset } from "#lib/password-reset";

const requestPasswordResetFormSchema = (messages: PlatformMessages) =>
  z.object({
    email: emailFormSchema(messages),
  });

export const requestPasswordResetAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  const parsed = requestPasswordResetFormSchema(messages).safeParse(
    toFormDataInput(formData, {
      email: "value",
    })
  );
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, { locale }),
      ok: false,
    };
  }

  const { email } = parsed.data;
  const result = await requestPlatformPasswordReset(email, locale);
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  const params = new URLSearchParams({ email });
  redirect(`/reset-password/requested?${params.toString()}`);
};
