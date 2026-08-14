"use server";

import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { confirmAdminPasswordReset } from "#lib/admin-auth";
import {
  authTokenFormSchema,
  passwordFormSchema,
  tenantIdFormSchema,
} from "#lib/auth-input";

const TENANT_MISSING_MESSAGE = "テナント識別子が見つかりませんでした。";

const tokenOrEmpty = (value: string | undefined): string => {
  const parsed = authTokenFormSchema.safeParse(value);
  return parsed.success ? parsed.data : "";
};

const trimmedPasswordFormSchema = z
  .string({ error: "パスワードを入力してください。" })
  .trim()
  .pipe(passwordFormSchema);

const confirmPasswordFormSchema = z
  .object({
    confirmPassword: trimmedPasswordFormSchema,
    password: trimmedPasswordFormSchema,
    tenantId: tenantIdFormSchema,
    token: authTokenFormSchema,
  })
  .refine((value) => value.password === value.confirmPassword, {
    error: "パスワード確認が一致しません。",
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
  const input = toFormDataInput(formData, {
    confirmPassword: { kind: "value", name: "confirm_password" },
    password: "value",
    tenantId: { kind: "value", name: "tenant_id" },
    token: "value",
  });
  const parsed = confirmPasswordFormSchema.safeParse(input);
  if (!parsed.success) {
    const token = tokenOrEmpty(input.token);
    const tenantIdResult = tenantIdFormSchema.safeParse(input.tenantId);
    if (!token) {
      redirect(buildConfirmPasswordPath({ status: "invalid" }));
    }
    redirect(
      buildConfirmPasswordPath({
        error: tenantIdResult.success
          ? toFormErrorMessage(parsed.error)
          : TENANT_MISSING_MESSAGE,
        token,
      })
    );
  }

  const { password, tenantId, token } = parsed.data;
  const result = await confirmAdminPasswordReset(tenantId, token, password);
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
