"use server";

import type { Locale } from "@publira/i18n";
import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { emailFormSchema } from "#lib/auth-input";
import { assertSameOrigin } from "#lib/csrf";
import { getPlatformLocale } from "#lib/locale";
import { requestPlatformPasswordReset } from "#lib/password-reset";

const requestPasswordResetFormSchema = async (locale: Locale) =>
  z.object({
    email: await emailFormSchema(locale),
  });

export const requestPasswordResetAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getPlatformLocale();

  const schema = await requestPasswordResetFormSchema(locale);
  const parsed = schema.safeParse(
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
