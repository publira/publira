"use server";

import type { Locale } from "@publira/i18n";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { authTokenFormSchema, passwordFormSchema } from "#lib/auth-input";
import { assertSameOrigin } from "#lib/csrf";
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { confirmPlatformPasswordReset } from "#lib/password-reset";

const tokenOrEmpty = async (
  locale: Locale,
  value: string | undefined
): Promise<string> => {
  const schema = await authTokenFormSchema(locale);
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : "";
};

const confirmPasswordFormSchema = async (locale: Locale) => {
  const [t, confirmPassword, password, token] = await Promise.all([
    getMessagesFor(locale),
    passwordFormSchema(locale),
    passwordFormSchema(locale),
    authTokenFormSchema(locale),
  ]);

  return z
    .object({ confirmPassword, password, token })
    .refine((value) => value.password === value.confirmPassword, {
      error: t("platform.auth.confirm_password.password_mismatch"),
      path: ["confirmPassword"],
    });
};

const buildConfirmPasswordPath = ({
  error,
  status,
  token,
}: {
  error?: string;
  status?: "expired" | "invalid";
  token?: string;
}): string => {
  const params = new URLSearchParams();

  if (error) {
    params.set("error", error);
  }
  if (status) {
    params.set("status", status);
  }
  if (token) {
    params.set("token", token);
  }

  const query = params.toString();
  return query ? `/confirm-password?${query}` : "/confirm-password";
};

const buildLoginPath = (): string =>
  `/login?${new URLSearchParams({ reset: "done" }).toString()}`;

export const confirmPasswordAction = async (
  formData: FormData
): Promise<void> => {
  await assertSameOrigin();
  const locale = await getPlatformLocale();

  const input = toFormDataInput(formData, {
    confirmPassword: { kind: "value", name: "confirm_password" },
    password: "value",
    token: "value",
  });
  const schema = await confirmPasswordFormSchema(locale);
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const token = await tokenOrEmpty(locale, input.token);
    if (!token) {
      redirect(buildConfirmPasswordPath({ status: "invalid" }));
    }
    redirect(
      buildConfirmPasswordPath({
        error: toFormErrorMessage(parsed.error, { locale }),
        token,
      })
    );
  }

  const { password, token } = parsed.data;
  const result = await confirmPlatformPasswordReset(token, password, locale);
  if (!result.ok) {
    if (result.reason === "expired" || result.reason === "invalid") {
      redirect(buildConfirmPasswordPath({ status: result.reason }));
    }

    redirect(
      buildConfirmPasswordPath({
        error: result.message,
        token,
      })
    );
  }

  redirect(buildLoginPath());
};
