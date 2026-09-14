"use server";

import type { Locale } from "@publira/i18n";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getActionLocale } from "#lib/action-messages";
import { confirmAdminPasswordReset } from "#lib/admin-auth";
import {
  authTokenFormSchema,
  passwordFormSchema,
  tenantIdFormSchema,
} from "#lib/auth-input";
import { assertSameOrigin } from "#lib/csrf";
import { getMessagesFor } from "#lib/messages";

const tokenOrEmpty = async (
  locale: Locale,
  value: string | undefined
): Promise<string> => {
  const schema = await authTokenFormSchema(locale);
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : "";
};

const trimmedPasswordFormSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z
    .string({
      error: t("admin.auth.fields.password_required"),
    })
    .trim()
    .pipe(await passwordFormSchema(locale));
};
const confirmPasswordFormSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z
    .object({
      confirmPassword: await trimmedPasswordFormSchema(locale),
      password: await trimmedPasswordFormSchema(locale),
      tenantId: await tenantIdFormSchema(locale),
      token: await authTokenFormSchema(locale),
    })
    .refine((value) => value.password === value.confirmPassword, {
      error: t("admin.auth.confirm_password.password_mismatch"),
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
  const locale = await getActionLocale(formData);
  const t = await getMessagesFor(locale);
  const input = toFormDataInput(formData, {
    confirmPassword: { kind: "value", name: "confirm_password" },
    password: "value",
    tenantId: { kind: "value", name: "tenant_id" },
    token: "value",
  });
  const schema = await confirmPasswordFormSchema(locale);
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const token = await tokenOrEmpty(locale, input.token);
    const tenantIdResultSchema = await tenantIdFormSchema(locale);
    const tenantIdResult = tenantIdResultSchema.safeParse(input.tenantId);
    if (!token) {
      redirect(buildConfirmPasswordPath({ status: "invalid" }));
    }
    redirect(
      buildConfirmPasswordPath({
        error: tenantIdResult.success
          ? toFormErrorMessage(parsed.error, { locale })
          : t("admin.auth.errors.tenant_missing"),
        token,
      })
    );
  }

  const { password, tenantId, token } = parsed.data;
  const result = await confirmAdminPasswordReset(
    tenantId,
    token,
    password,
    locale
  );
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
