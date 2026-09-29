"use server";

import type { Locale } from "@publira/i18n";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { z } from "zod";

import { emailFormSchema, passwordFormSchema } from "#lib/auth-input";
import { withPlatformSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { requestPlatformEmailChange } from "#lib/email-change";
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";

export type PlatformEmailChangeActionState =
  | { message: string; ok: false }
  | { message: string; ok: true }
  | null;

const loadActionCatalog = async () => {
  const locale = await getPlatformLocale();
  const t = await getMessagesFor(locale);

  return { locale, t };
};

const emailChangeFormSchema = async (locale: Locale) => {
  const [currentEmail, currentPassword, newEmail] = await Promise.all([
    emailFormSchema(locale),
    passwordFormSchema(locale),
    emailFormSchema(locale),
  ]);

  return z.object({ currentEmail, currentPassword, newEmail });
};

export const requestPlatformEmailChangeAction = async (
  _prevState: PlatformEmailChangeActionState,
  formData: FormData
): Promise<PlatformEmailChangeActionState> => {
  await assertSameOrigin();
  const { locale, t } = await loadActionCatalog();
  const schema = await emailChangeFormSchema(locale);

  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      currentEmail: { kind: "value", name: "current_email" },
      currentPassword: { kind: "value", name: "current_password" },
      newEmail: { kind: "value", name: "new_email" },
    })
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const result = await withPlatformSessionReauth(() =>
    requestPlatformEmailChange(
      parsed.data.currentEmail,
      parsed.data.newEmail,
      parsed.data.currentPassword,
      locale
    )
  );

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  return {
    message: t("platform.settings.email_change_success"),
    ok: true,
  };
};
