"use server";

import { getMessage } from "@publira/i18n";
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
import { loadAdminMessages } from "#lib/locale";
import type { AdminMessages } from "#lib/locale";

const tokenOrEmpty = (
  messages: AdminMessages,
  value: string | undefined
): string => {
  const parsed = authTokenFormSchema(messages).safeParse(value);
  return parsed.success ? parsed.data : "";
};

const trimmedPasswordFormSchema = (messages: AdminMessages) =>
  z
    .string({
      error: getMessage(messages, "admin.auth.fields.password_required"),
    })
    .trim()
    .pipe(passwordFormSchema(messages));

const confirmPasswordFormSchema = (messages: AdminMessages) =>
  z
    .object({
      confirmPassword: trimmedPasswordFormSchema(messages),
      password: trimmedPasswordFormSchema(messages),
      tenantId: tenantIdFormSchema(messages),
      token: authTokenFormSchema(messages),
    })
    .refine((value) => value.password === value.confirmPassword, {
      error: getMessage(
        messages,
        "admin.auth.confirm_password.password_mismatch"
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
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const messages = await loadAdminMessages(locale);
  const input = toFormDataInput(formData, {
    confirmPassword: { kind: "value", name: "confirm_password" },
    password: "value",
    tenantId: { kind: "value", name: "tenant_id" },
    token: "value",
  });
  const parsed = confirmPasswordFormSchema(messages).safeParse(input);
  if (!parsed.success) {
    const token = tokenOrEmpty(messages, input.token);
    const tenantIdResult = tenantIdFormSchema(messages).safeParse(
      input.tenantId
    );
    if (!token) {
      redirect(buildConfirmPasswordPath({ status: "invalid" }));
    }
    redirect(
      buildConfirmPasswordPath({
        error: tenantIdResult.success
          ? toFormErrorMessage(parsed.error, { locale })
          : getMessage(messages, "admin.auth.errors.tenant_missing"),
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
