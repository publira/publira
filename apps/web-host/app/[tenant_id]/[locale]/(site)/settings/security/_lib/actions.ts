"use server";

import { getMessage, parseLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import {
  toFormErrorMessage,
  validationErrorMessage,
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
import { loadHostMessages } from "#lib/messages";
import type { HostMessages } from "#lib/messages";

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

const requestEmailChangeFormSchema = (messages: HostMessages) =>
  z.object({
    currentEmail: emailFormSchema(messages),
    currentPassword: passwordFormSchema(messages),
    locale: localeFormSchema,
    newEmail: emailFormSchema(messages),
    tenantId: tenantIdFormSchema(messages),
  });

export const requestEmailChangeAction = async (
  formData: FormData
): Promise<void> => {
  await assertSameOrigin();
  // The locale field falls back rather than failing, so a rejected submission
  // is still worded in the reader's language.
  const submittedLocale = parseLocale(formData.get("locale"));
  const messages = await loadHostMessages(submittedLocale);
  const parsed = requestEmailChangeFormSchema(messages).safeParse(
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
        submittedLocale,
        "error",
        toFormErrorMessage(parsed.error, {
          fallback: validationErrorMessage(submittedLocale),
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
        getMessage(messages, "host.settings.email_change_failed")
      )
    );
  }

  redirect(
    buildSettingsPath(
      locale,
      "success",
      getMessage(messages, "host.settings.email_change_requested")
    )
  );
};
