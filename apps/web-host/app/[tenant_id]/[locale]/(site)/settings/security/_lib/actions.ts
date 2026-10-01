"use server";

import { rpcErrorMessage } from "@publira/api-client/error-messages";
import type { Locale } from "@publira/i18n";
import {
  toFormErrorMessage,
  validationErrorMessage,
} from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  changePublicPassword,
  requestPublicEmailChange,
  unlinkMyIdentity,
} from "#lib/auth";
import {
  emailFormSchema,
  passwordFormSchema,
  tenantIdFormSchema,
} from "#lib/auth-input";
import {
  requirePublicSession,
  withPublicSessionReauth,
  writePublicSessionCookie,
} from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { localeFormSchema, requireFormLocale } from "#lib/locale-form";
import { getMessagesFor } from "#lib/messages";
import { SIGN_IN_PROVIDERS } from "#lib/sign-in-provider";
import { sendToProvider } from "#lib/social-sign-in-start";
import { tenantLocalePath } from "#lib/tenant-locale-path";

const SECURITY_SETTINGS_RETURN_TO = "/settings/security";

const buildSettingsPath = async (
  locale: Locale,
  tenantId: string,
  status: "success" | "error",
  message: string
): Promise<string> => {
  const params = new URLSearchParams({ message, status });
  const path = await tenantLocalePath(
    tenantId,
    locale,
    SECURITY_SETTINGS_RETURN_TO
  );
  return `${path}?${params.toString()}`;
};

const requestEmailChangeFormSchema = async (locale: Locale) => {
  const [currentEmail, currentPassword, newEmail, tenantId] = await Promise.all(
    [
      emailFormSchema(locale),
      passwordFormSchema(locale),
      emailFormSchema(locale),
      tenantIdFormSchema(locale),
    ]
  );

  return z.object({
    currentEmail,
    currentPassword,
    locale: localeFormSchema,
    newEmail,
    tenantId,
  });
};

export const requestEmailChangeAction = async (
  formData: FormData
): Promise<void> => {
  await assertSameOrigin();
  // The locale field falls back rather than failing, so a rejected submission
  // is still worded in the reader's language.
  const submittedLocale = requireFormLocale(formData.get("locale"));
  const [t, schema] = await Promise.all([
    getMessagesFor(submittedLocale),
    requestEmailChangeFormSchema(submittedLocale),
  ]);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      currentEmail: "value",
      currentPassword: "value",
      locale: "value",
      newEmail: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    const errorPath = await buildSettingsPath(
      submittedLocale,
      String(formData.get("tenantId") ?? ""),
      "error",
      toFormErrorMessage(parsed.error, {
        fallback: validationErrorMessage(submittedLocale),
        locale: submittedLocale,
      })
    );
    redirect(errorPath);
  }

  const { currentEmail, currentPassword, locale, newEmail, tenantId } =
    parsed.data;
  const accessToken = await requirePublicSession(
    locale,
    SECURITY_SETTINGS_RETURN_TO,
    tenantId
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
        { password: currentPassword },
        accessToken
      ),
    tenantId
  );
  if (!requested) {
    const errorPath = await buildSettingsPath(
      locale,
      tenantId,
      "error",
      t("host.settings.email_change_failed")
    );
    redirect(errorPath);
  }

  const successPath = await buildSettingsPath(
    locale,
    tenantId,
    "success",
    t("host.settings.email_change_requested")
  );
  redirect(successPath);
};

const confirmEmailChangeWithProviderFormSchema = async (locale: Locale) => {
  const [currentEmail, newEmail, tenantId] = await Promise.all([
    emailFormSchema(locale),
    emailFormSchema(locale),
    tenantIdFormSchema(locale),
  ]);

  return z.object({
    currentEmail,
    locale: localeFormSchema,
    newEmail,
    provider: z.enum(SIGN_IN_PROVIDERS),
    tenantId,
  });
};

/**
 * The email change of an account without a password, which has none to
 * confirm with: the reader signs in again with the provider whose button they
 * pressed, and the callback asks for the change with that sign-in.
 */
export const confirmEmailChangeWithProviderAction = async (
  formData: FormData
): Promise<void> => {
  await assertSameOrigin();
  const submittedLocale = requireFormLocale(formData.get("locale"));
  const schema =
    await confirmEmailChangeWithProviderFormSchema(submittedLocale);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      currentEmail: "value",
      locale: "value",
      newEmail: "value",
      provider: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    const errorPath = await buildSettingsPath(
      submittedLocale,
      String(formData.get("tenantId") ?? ""),
      "error",
      toFormErrorMessage(parsed.error, {
        fallback: validationErrorMessage(submittedLocale),
        locale: submittedLocale,
      })
    );
    redirect(errorPath);
  }

  const { currentEmail, locale, newEmail, provider, tenantId } = parsed.data;
  const accessToken = await requirePublicSession(
    locale,
    SECURITY_SETTINGS_RETURN_TO,
    tenantId
  );
  await sendToProvider({
    accessToken,
    emailChange: { currentEmail, newEmail },
    intent: "email_change",
    locale,
    provider,
    returnTo: SECURITY_SETTINGS_RETURN_TO,
    tenantId,
  });
};

const changePasswordFormSchema = async (locale: Locale) => {
  const [t, confirmPassword, currentPassword, newPassword, tenantId] =
    await Promise.all([
      getMessagesFor(locale),
      passwordFormSchema(locale),
      passwordFormSchema(locale),
      passwordFormSchema(locale),
      tenantIdFormSchema(locale),
    ]);

  return (
    z
      .object({
        confirmPassword,
        currentPassword,
        locale: localeFormSchema,
        newPassword,
        tenantId,
      })
      .refine((value) => value.newPassword === value.confirmPassword, {
        error: t("host.auth.errors.password_mismatch"),
        path: ["confirmPassword"],
      })
      // The API refuses this too, on the same grounds. Checking it here is what
      // gives the reader the reason: whatever the RPC rejects comes back as the
      // one message this form has for a refused submission.
      .refine((value) => value.newPassword !== value.currentPassword, {
        error: t("host.settings.password_unchanged"),
        path: ["newPassword"],
      })
  );
};

export const changePasswordAction = async (
  formData: FormData
): Promise<void> => {
  await assertSameOrigin();
  // The locale field falls back rather than failing, so a rejected submission
  // is still worded in the reader's language.
  const submittedLocale = requireFormLocale(formData.get("locale"));
  const [t, schema] = await Promise.all([
    getMessagesFor(submittedLocale),
    changePasswordFormSchema(submittedLocale),
  ]);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      confirmPassword: "value",
      currentPassword: "value",
      locale: "value",
      newPassword: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    const errorPath = await buildSettingsPath(
      submittedLocale,
      String(formData.get("tenantId") ?? ""),
      "error",
      toFormErrorMessage(parsed.error, {
        fallback: validationErrorMessage(submittedLocale),
        locale: submittedLocale,
      })
    );
    redirect(errorPath);
  }

  const { currentPassword, locale, newPassword, tenantId } = parsed.data;
  const accessToken = await requirePublicSession(
    locale,
    SECURITY_SETTINGS_RETURN_TO,
    tenantId
  );
  // A wrong `currentPassword` is `invalid_argument` with a field violation, not
  // `unauthenticated`, so it stays a form error instead of ending the session.
  const changed = await withPublicSessionReauth(
    locale,
    SECURITY_SETTINGS_RETURN_TO,
    () =>
      changePublicPassword(tenantId, currentPassword, newPassword, accessToken),
    tenantId
  );
  if (!changed) {
    const errorPath = await buildSettingsPath(
      locale,
      tenantId,
      "error",
      t("host.settings.password_change_failed")
    );
    redirect(errorPath);
  }

  // The change ended the token this request arrived with, so the browser that
  // made it is signed out too unless the replacement the API minted takes the
  // cookie's place before the redirect.
  await writePublicSessionCookie(changed, tenantId);

  const successPath = await buildSettingsPath(
    locale,
    tenantId,
    "success",
    t("host.settings.password_changed")
  );
  redirect(successPath);
};

const unlinkIdentityFormSchema = async (locale: Locale) => {
  const tenantId = await tenantIdFormSchema(locale);

  return z.object({
    locale: localeFormSchema,
    provider: z.enum(SIGN_IN_PROVIDERS),
    tenantId,
  });
};

export const unlinkIdentityAction = async (
  formData: FormData
): Promise<void> => {
  await assertSameOrigin();
  const submittedLocale = requireFormLocale(formData.get("locale"));
  const [t, schema] = await Promise.all([
    getMessagesFor(submittedLocale),
    unlinkIdentityFormSchema(submittedLocale),
  ]);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      locale: "value",
      provider: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    const errorPath = await buildSettingsPath(
      submittedLocale,
      String(formData.get("tenantId") ?? ""),
      "error",
      t("host.settings.linked_account_unlink_failed")
    );
    redirect(errorPath);
  }

  const { locale, provider, tenantId } = parsed.data;
  const accessToken = await requirePublicSession(
    locale,
    SECURITY_SETTINGS_RETURN_TO,
    tenantId
  );
  const result = await withPublicSessionReauth(
    locale,
    SECURITY_SETTINGS_RETURN_TO,
    () => unlinkMyIdentity(tenantId, provider, accessToken),
    tenantId
  );
  if (!result.ok) {
    const errorPath = await buildSettingsPath(
      locale,
      tenantId,
      "error",
      rpcErrorMessage(
        result.error,
        t("host.settings.linked_account_unlink_failed"),
        {
          locale,
          overrides: { precondition: t("host.settings.linked_account_last") },
        }
      )
    );
    redirect(errorPath);
  }

  const successPath = await buildSettingsPath(
    locale,
    tenantId,
    "success",
    t("host.settings.linked_account_unlinked")
  );
  redirect(successPath);
};
