"use server";

import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requestPublicPasswordReset } from "#lib/auth";
import { emailFormSchema, tenantIdFormSchema } from "#lib/auth-input";
import { assertSameOrigin } from "#lib/csrf";
import {
  RESET_PASSWORD_REQUESTED_EMAIL_COOKIE,
  setEmailFlashCookie,
} from "#lib/email-flash-cookie";
import { localeFormSchema } from "#lib/locale-form";
import { withLocalePrefix } from "#lib/locale-path";

const requestPasswordResetFormSchema = z.object({
  email: emailFormSchema,
  locale: localeFormSchema,
  tenantId: tenantIdFormSchema,
});

export const requestPasswordResetAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const parsed = requestPasswordResetFormSchema.safeParse(
    toFormDataInput(formData, {
      email: "value",
      locale: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error),
      ok: false,
    };
  }

  const { email, locale, tenantId } = parsed.data;
  const requested = await requestPublicPasswordReset(email, tenantId);
  if (!requested) {
    return {
      message: "再設定メールの送信に失敗しました。入力内容をご確認ください。",
      ok: false,
    };
  }

  await setEmailFlashCookie(RESET_PASSWORD_REQUESTED_EMAIL_COOKIE, email);
  redirect(withLocalePrefix(locale, "/reset-password/requested"));
};
