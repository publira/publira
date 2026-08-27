"use server";

import { parseLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
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
import { assertSameOrigin } from "#lib/csrf";
import { localeFormSchema } from "#lib/locale-form";
import { withLocalePrefix } from "#lib/locale-path";

const SECURITY_SETTINGS_RETURN_TO = "/settings/security";

const buildSettingsPath = (
  locale: Locale,
  status: "success" | "error",
  message: string
) => {
  const params = new URLSearchParams({ message, status });
  const path = withLocalePrefix(locale, SECURITY_SETTINGS_RETURN_TO);
  return `${path}?${params.toString()}`;
};

const requestEmailChangeFormSchema = z.object({
  currentEmail: emailFormSchema,
  currentPassword: passwordFormSchema,
  locale: localeFormSchema,
  newEmail: emailFormSchema,
  tenantId: tenantIdFormSchema,
});

export const requestEmailChangeAction = async (
  formData: FormData
): Promise<void> => {
  await assertSameOrigin();
  const parsed = requestEmailChangeFormSchema.safeParse(
    toFormDataInput(formData, {
      currentEmail: "value",
      currentPassword: "value",
      locale: "value",
      newEmail: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    redirect(
      buildSettingsPath(
        parseLocale(formData.get("locale")),
        "error",
        toFormErrorMessage(parsed.error, {
          fallback: VALIDATION_ERROR_MESSAGE,
        })
      )
    );
  }

  const { currentEmail, currentPassword, locale, newEmail, tenantId } =
    parsed.data;
  const accessToken = await requirePublicSession(
    locale,
    SECURITY_SETTINGS_RETURN_TO
  );
  // A wrong `currentPassword` is `invalid_argument` with a field violation, not
  // `unauthenticated`, so it stays a form error instead of ending the session.
  const requested = await withPublicSessionReauth(
    locale,
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
        locale,
        "error",
        "メール変更リクエストに失敗しました。入力内容をご確認ください。"
      )
    );
  }

  redirect(
    buildSettingsPath(
      locale,
      "success",
      "現在のメールアドレスと新しいメールアドレスの両方に確認メールを送信しました。両方のリンクを開いて変更を完了してください。"
    )
  );
};
