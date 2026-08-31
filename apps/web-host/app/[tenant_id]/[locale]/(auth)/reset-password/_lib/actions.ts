"use server";

import { getMessage } from "@publira/i18n";
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
import { localeFormSchema, requireFormLocale } from "#lib/locale-form";
import { loadHostMessages } from "#lib/messages";
import type { HostMessages } from "#lib/messages";
import { tenantLocalePath } from "#lib/tenant-locale-path";

const requestPasswordResetFormSchema = (messages: HostMessages) =>
  z.object({
    email: emailFormSchema(messages),
    locale: localeFormSchema,
    tenantId: tenantIdFormSchema(messages),
  });

export const requestPasswordResetAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  // The locale field falls back rather than failing, so a rejected submission
  // is still worded in the reader's language.
  const submittedLocale = requireFormLocale(formData.get("locale"));
  const messages = await loadHostMessages(submittedLocale);
  const parsed = requestPasswordResetFormSchema(messages).safeParse(
    toFormDataInput(formData, {
      email: "value",
      locale: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, { locale: submittedLocale }),
      ok: false,
    };
  }

  const { email, locale, tenantId } = parsed.data;
  const requested = await requestPublicPasswordReset(email, tenantId);
  if (!requested) {
    return {
      message: getMessage(messages, "host.auth.errors.reset_request_failed"),
      ok: false,
    };
  }

  await setEmailFlashCookie(RESET_PASSWORD_REQUESTED_EMAIL_COOKIE, email);
  const requestedPath = await tenantLocalePath(
    tenantId,
    locale,
    "/reset-password/requested"
  );
  redirect(requestedPath);
};
