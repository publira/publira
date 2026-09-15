"use server";

import type { Locale } from "@publira/i18n";
import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { signupPublic } from "#lib/auth";
import {
  birthDateFormSchema,
  emailFormSchema,
  passwordFormSchema,
  tenantIdFormSchema,
} from "#lib/auth-input";
import { assertSameOrigin } from "#lib/csrf";
import {
  setEmailFlashCookie,
  SIGNUP_PENDING_EMAIL_COOKIE,
} from "#lib/email-flash-cookie";
import { localeFormSchema, requireFormLocale } from "#lib/locale-form";
import { getMessagesFor } from "#lib/messages";
import { tenantLocalePath } from "#lib/tenant-locale-path";

const signupFormSchema = async (locale: Locale) => {
  const [t, birthDate, email, password, tenantId] = await Promise.all([
    getMessagesFor(locale),
    birthDateFormSchema(locale),
    emailFormSchema(locale),
    passwordFormSchema(locale),
    tenantIdFormSchema(locale),
  ]);
  const confirmRequired = t("host.auth.errors.password_confirm_required");
  const nameRequired = t("host.auth.errors.name_required");

  return z
    .object({
      birthDate,
      confirmPassword: z
        .string({ error: confirmRequired })
        .min(1, confirmRequired)
        .max(1024, t("host.auth.errors.password_confirm_too_long")),
      email,
      locale: localeFormSchema,
      name: z
        .string({ error: nameRequired })
        .trim()
        .min(1, nameRequired)
        .max(100, t("host.auth.errors.name_too_long")),
      password,
      tenantId,
    })
    .refine((value) => value.password === value.confirmPassword, {
      error: t("host.auth.errors.password_mismatch"),
      path: ["confirmPassword"],
    });
};

export const signupAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  // The locale field falls back rather than failing, so a rejected submission
  // is still worded in the reader's language.
  const submittedLocale = requireFormLocale(formData.get("locale"));
  const [t, schema] = await Promise.all([
    getMessagesFor(submittedLocale),
    signupFormSchema(submittedLocale),
  ]);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      birthDate: "value",
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
      message: toFormErrorMessage(parsed.error, { locale: submittedLocale }),
      ok: false,
    };
  }

  const { birthDate, email, locale, name, password, tenantId } = parsed.data;
  const accepted = await signupPublic({
    birthDate,
    email,
    name,
    password,
    tenantId,
  });
  if (!accepted) {
    return {
      message: t("host.auth.errors.signup_failed"),
      ok: false,
    };
  }

  // Every accepted sign-up ends here, including one whose address already has
  // an account: the reader is told to open their mail, and only the mail says
  // which of the two happened.
  await setEmailFlashCookie(SIGNUP_PENDING_EMAIL_COOKIE, email);
  const pendingPath = await tenantLocalePath(
    tenantId,
    locale,
    "/signup/pending"
  );
  redirect(pendingPath);
};
