"use server";

import type { Locale } from "@publira/i18n";
import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requestPublicEmailVerification } from "#lib/auth";
import { emailFormSchema, tenantIdFormSchema } from "#lib/auth-input";
import { assertSameOrigin } from "#lib/csrf";
import {
  RESEND_VERIFICATION_REQUESTED_EMAIL_COOKIE,
  setEmailFlashCookie,
} from "#lib/email-flash-cookie";
import { localeFormSchema, requireFormLocale } from "#lib/locale-form";
import { getMessagesFor } from "#lib/messages";
import { tenantLocalePath } from "#lib/tenant-locale-path";

const requestEmailVerificationFormSchema = async (locale: Locale) => {
  const [email, tenantId] = await Promise.all([
    emailFormSchema(locale),
    tenantIdFormSchema(locale),
  ]);

  return z.object({ email, locale: localeFormSchema, tenantId });
};

export const requestEmailVerificationAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  // The locale field falls back rather than failing, so a rejected submission
  // is still worded in the reader's language.
  const submittedLocale = requireFormLocale(formData.get("locale"));
  const [t, schema] = await Promise.all([
    getMessagesFor(submittedLocale),
    requestEmailVerificationFormSchema(submittedLocale),
  ]);
  const parsed = schema.safeParse(
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
  const requested = await requestPublicEmailVerification(email, tenantId);
  if (!requested) {
    return {
      message: t("host.auth.errors.resend_verification_failed"),
      ok: false,
    };
  }

  // Every accepted request ends here, whether the address is waiting to be
  // confirmed, already confirmed, or has no account at all: only the mailbox
  // says which.
  await setEmailFlashCookie(RESEND_VERIFICATION_REQUESTED_EMAIL_COOKIE, email);
  const requestedPath = await tenantLocalePath(
    tenantId,
    locale,
    "/resend-verification/requested"
  );
  redirect(requestedPath);
};
