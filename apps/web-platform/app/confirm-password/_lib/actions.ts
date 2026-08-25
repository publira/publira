"use server";

import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { getMessage } from "@publira/utils/i18n";
import { redirect } from "next/navigation";
import { z } from "zod";

import { authTokenFormSchema, passwordFormSchema } from "#lib/auth-input";
import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";
import type { PlatformMessages } from "#lib/locale";
import { confirmPlatformPasswordReset } from "#lib/password-reset";

const tokenOrEmpty = (
  messages: PlatformMessages,
  value: string | undefined
): string => {
  const parsed = authTokenFormSchema(messages).safeParse(value);
  return parsed.success ? parsed.data : "";
};

const trimmedPasswordFormSchema = (messages: PlatformMessages) =>
  z
    .string({
      error: getMessage(messages, "platform.auth.fields.password_required"),
    })
    .trim()
    .pipe(passwordFormSchema(messages));

const confirmPasswordFormSchema = (messages: PlatformMessages) =>
  z
    .object({
      confirmPassword: trimmedPasswordFormSchema(messages),
      password: trimmedPasswordFormSchema(messages),
      token: authTokenFormSchema(messages),
    })
    .refine((value) => value.password === value.confirmPassword, {
      error: getMessage(
        messages,
        "platform.auth.confirm_password.password_mismatch"
      ),
      path: ["confirmPassword"],
    });

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
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  const input = toFormDataInput(formData, {
    confirmPassword: { kind: "value", name: "confirm_password" },
    password: "value",
    token: "value",
  });
  const parsed = confirmPasswordFormSchema(messages).safeParse(input);
  if (!parsed.success) {
    const token = tokenOrEmpty(messages, input.token);
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
