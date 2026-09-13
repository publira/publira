"use server";

import type { Locale } from "@publira/i18n";
import {
  toFormErrorMessage,
  validationErrorMessage,
} from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { changePublicPassword, requestPublicEmailChange } from "#lib/auth";
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
import type { HostMessageAccessor } from "#lib/messages";
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

const requestEmailChangeFormSchema = (t: HostMessageAccessor) =>
  z.object({
    currentEmail: emailFormSchema(t),
    currentPassword: passwordFormSchema(t),
    locale: localeFormSchema,
    newEmail: emailFormSchema(t),
    tenantId: tenantIdFormSchema(t),
  });

export const requestEmailChangeAction = async (
  formData: FormData
): Promise<void> => {
  await assertSameOrigin();
  // The locale field falls back rather than failing, so a rejected submission
  // is still worded in the reader's language.
  const submittedLocale = requireFormLocale(formData.get("locale"));
  const t = await getMessagesFor(submittedLocale);
  const parsed = requestEmailChangeFormSchema(t).safeParse(
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
        currentPassword,
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

const changePasswordFormSchema = (t: HostMessageAccessor) =>
  z
    .object({
      confirmPassword: passwordFormSchema(t),
      currentPassword: passwordFormSchema(t),
      locale: localeFormSchema,
      newPassword: passwordFormSchema(t),
      tenantId: tenantIdFormSchema(t),
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
    });

export const changePasswordAction = async (
  formData: FormData
): Promise<void> => {
  await assertSameOrigin();
  // The locale field falls back rather than failing, so a rejected submission
  // is still worded in the reader's language.
  const submittedLocale = requireFormLocale(formData.get("locale"));
  const t = await getMessagesFor(submittedLocale);
  const parsed = changePasswordFormSchema(t).safeParse(
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
