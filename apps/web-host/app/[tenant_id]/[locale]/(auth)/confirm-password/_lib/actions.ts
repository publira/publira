"use server";

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
import { localeFormSchema, requireFormLocale } from "#lib/locale-form";
import { getMessagesFor } from "#lib/messages";
import { tenantLocalePath } from "#lib/tenant-locale-path";

const tokenOrEmpty = async (
  locale: Locale,
  value: string | undefined
): Promise<string> => {
  const schema = await authTokenFormSchema(locale);
  const parsed = schema.safeParse(value);

  return parsed.success ? parsed.data : "";
};

const confirmPasswordFormSchema = async (locale: Locale) => {
  const [t, confirmPassword, newPassword, tenantId, token] = await Promise.all([
    getMessagesFor(locale),
    passwordFormSchema(locale),
    passwordFormSchema(locale),
    tenantIdFormSchema(locale),
    authTokenFormSchema(locale),
  ]);

  return z
    .object({
      confirmPassword,
      locale: localeFormSchema,
      newPassword,
      tenantId,
      token,
    })
    .refine((value) => value.newPassword === value.confirmPassword, {
      error: t("host.auth.errors.password_mismatch"),
      path: ["confirmPassword"],
    });
};

const buildConfirmPasswordErrorPath = async (
  locale: Locale,
  tenantId: string,
  token: string,
  message: string
): Promise<string> => {
  const params = new URLSearchParams({
    error: message,
    token,
  });
  const path = await tenantLocalePath(tenantId, locale, "/confirm-password");
  return `${path}?${params.toString()}`;
};

const buildLoginPathWithResetResult = async (
  locale: Locale,
  tenantId: string
): Promise<string> => {
  const params = new URLSearchParams({ reset: "done" });
  const path = await tenantLocalePath(tenantId, locale, "/login");
  return `${path}?${params.toString()}`;
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
  const submittedLocale = requireFormLocale(input.locale);
  const [t, schema] = await Promise.all([
    getMessagesFor(submittedLocale),
    confirmPasswordFormSchema(submittedLocale),
  ]);
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const token = await tokenOrEmpty(submittedLocale, input.token);
    const errorPath = await buildConfirmPasswordErrorPath(
      submittedLocale,
      String(input.tenantId ?? ""),
      token,
      toFormErrorMessage(parsed.error, { locale: submittedLocale })
    );
    redirect(errorPath);
  }

  const { locale, newPassword, tenantId, token } = parsed.data;
  const confirmed = await confirmPublicPasswordReset(
    token,
    newPassword,
    tenantId
  );
  if (!confirmed) {
    const errorPath = await buildConfirmPasswordErrorPath(
      locale,
      tenantId,
      token,
      t("host.auth.errors.reset_confirm_failed")
    );
    redirect(errorPath);
  }

  const loginPath = await buildLoginPathWithResetResult(locale, tenantId);
  redirect(loginPath);
};
