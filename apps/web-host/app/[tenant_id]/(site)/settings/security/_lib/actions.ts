"use server";

import {
  toFormErrorMessage,
  VALIDATION_ERROR_MESSAGE,
} from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requestPublicEmailChange } from "#lib/auth";
import {
  emailFormSchema,
  passwordFormSchema,
  tenantIdFormSchema,
} from "#lib/auth-input";
import {
  requirePublicSession,
  withPublicSessionReauth,
} from "#lib/auth-session";

const SECURITY_SETTINGS_RETURN_TO = "/settings/security";

const buildSettingsPath = (status: "success" | "error", message: string) => {
  const params = new URLSearchParams({ message, status });
  return `/settings/security?${params.toString()}`;
};

const requestEmailChangeFormSchema = z.object({
  currentEmail: emailFormSchema,
  currentPassword: passwordFormSchema,
  newEmail: emailFormSchema,
  tenantId: tenantIdFormSchema,
});

export const requestEmailChangeAction = async (
  formData: FormData
): Promise<void> => {
  const parsed = requestEmailChangeFormSchema.safeParse(
    toFormDataInput(formData, {
      currentEmail: "value",
      currentPassword: "value",
      newEmail: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    redirect(
      buildSettingsPath(
        "error",
        toFormErrorMessage(parsed.error, {
          fallback: VALIDATION_ERROR_MESSAGE,
        })
      )
    );
  }

  const { currentEmail, currentPassword, newEmail, tenantId } = parsed.data;
  const accessToken = await requirePublicSession(SECURITY_SETTINGS_RETURN_TO);
  // A wrong `currentPassword` is `invalid_argument` with a field violation, not
  // `unauthenticated`, so it stays a form error instead of ending the session.
  const requested = await withPublicSessionReauth(
    SECURITY_SETTINGS_RETURN_TO,
    () =>
      requestPublicEmailChange(
        tenantId,
        currentEmail,
        newEmail,
        currentPassword,
        accessToken
      )
  );
  if (!requested) {
    redirect(
      buildSettingsPath(
        "error",
        "メール変更リクエストに失敗しました。入力内容をご確認ください。"
      )
    );
  }

  redirect(
    buildSettingsPath(
      "success",
      "現在のメールアドレスと新しいメールアドレスの両方に確認メールを送信しました。両方のリンクを開いて変更を完了してください。"
    )
  );
};
