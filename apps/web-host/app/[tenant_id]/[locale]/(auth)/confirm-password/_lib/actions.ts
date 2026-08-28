"use server";

import { getMessage, parseLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { confirmPublicPasswordReset } from "#lib/auth";
import {
  authTokenFormSchema,
  passwordFormSchema,
  tenantIdFormSchema,
} from "#lib/auth-input";
import { assertSameOrigin } from "#lib/csrf";
import { localeFormSchema } from "#lib/locale-form";
import { withLocalePrefix } from "#lib/locale-path";
import { loadHostMessages } from "#lib/messages";
import type { HostMessages } from "#lib/messages";

const tokenOrEmpty = (
  messages: HostMessages,
  value: string | undefined
): string => {
  const parsed = authTokenFormSchema(messages).safeParse(value);
  return parsed.success ? parsed.data : "";
};

const confirmPasswordFormSchema = (messages: HostMessages) =>
  z
    .object({
      confirmPassword: passwordFormSchema(messages),
      locale: localeFormSchema,
      newPassword: passwordFormSchema(messages),
      tenantId: tenantIdFormSchema(messages),
      token: authTokenFormSchema(messages),
    })
    .refine((value) => value.newPassword === value.confirmPassword, {
      error: getMessage(messages, "host.auth.errors.password_mismatch"),
      path: ["confirmPassword"],
    });

const buildConfirmPasswordErrorPath = (
  locale: Locale,
  token: string,
  message: string
): string => {
  const params = new URLSearchParams({
    error: message,
    token,
  });
  const path = withLocalePrefix(locale, "/confirm-password");
  return `${path}?${params.toString()}`;
};

const buildLoginPathWithResetResult = (locale: Locale): string => {
  const params = new URLSearchParams({ reset: "done" });
  return `${withLocalePrefix(locale, "/login")}?${params.toString()}`;
};

export const confirmPasswordAction = async (
  formData: FormData
): Promise<void> => {
  await assertSameOrigin();
  const input = toFormDataInput(formData, {
    confirmPassword: "value",
    locale: "value",
    newPassword: "value",
    tenantId: "value",
    token: "value",
  });
  // The locale field falls back rather than failing, so a rejected submission
  // is still worded in the reader's language.
  const submittedLocale = parseLocale(input.locale);
  const messages = await loadHostMessages(submittedLocale);
  const parsed = confirmPasswordFormSchema(messages).safeParse(input);
  if (!parsed.success) {
    const token = tokenOrEmpty(messages, input.token);
    redirect(
      buildConfirmPasswordErrorPath(
        submittedLocale,
        token,
        toFormErrorMessage(parsed.error, { locale: submittedLocale })
      )
    );
  }

  const { locale, newPassword, tenantId, token } = parsed.data;
  const confirmed = await confirmPublicPasswordReset(
    token,
    newPassword,
    tenantId
  );
  if (!confirmed) {
    redirect(
      buildConfirmPasswordErrorPath(
        locale,
        token,
        getMessage(messages, "host.auth.errors.reset_confirm_failed")
      )
    );
  }

  redirect(buildLoginPathWithResetResult(locale));
};
