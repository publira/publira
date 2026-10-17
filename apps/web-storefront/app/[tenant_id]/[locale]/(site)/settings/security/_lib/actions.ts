"use server";

import { rpcErrorMessage } from "@publira/api-client/error-messages";
import type { Locale } from "@publira/i18n";
import type { FormActionState } from "@publira/ui-components/action-form";
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
  passkeyCredentialFormSchema,
  passwordFormSchema,
  tenantIdFormSchema,
} from "#lib/auth-input";
import {
  requirePublicSession,
  withPublicSessionReauth,
  writePublicSessionCookie,
} from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { emailRefusalMessage } from "#lib/email-refusal-message";
import { localeFormSchema, requireFormLocale } from "#lib/locale-form";
import { getMessagesFor } from "#lib/messages";
import { SIGN_IN_PROVIDERS } from "#lib/sign-in-provider";
import { sendToProvider } from "#lib/social-sign-in-start";

import {
  buildSecuritySettingsPath,
  SECURITY_SETTINGS_RETURN_TO,
} from "./security-path";

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
    const errorPath = await buildSecuritySettingsPath(
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
  const emailChange = await withPublicSessionReauth(
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
  if (!emailChange.ok) {
    const errorPath = await buildSecuritySettingsPath(
      locale,
      tenantId,
      "error",
      emailRefusalMessage(
        t,
        emailChange.emailRefusal,
        t("storefront.settings.email_change_failed")
      )
    );
    redirect(errorPath);
  }

  const successPath = await buildSecuritySettingsPath(
    locale,
    tenantId,
    "success",
    t("storefront.settings.email_change_requested")
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
    const errorPath = await buildSecuritySettingsPath(
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

const requestEmailChangeWithPasskeyFormSchema = async (locale: Locale) => {
  const [currentEmail, newEmail, tenantId] = await Promise.all([
    emailFormSchema(locale),
    emailFormSchema(locale),
    tenantIdFormSchema(locale),
  ]);

  return z.object({
    currentEmail,
    locale: localeFormSchema,
    newEmail,
    passkeyCredential: passkeyCredentialFormSchema,
    tenantId,
  });
};

/**
 * The email change of an account without a password, confirmed with an
 * assertion one of its passkeys made. A refusal stays on the form, with the
 * addresses the reader typed, beside the button they can try again with.
 */
export const requestEmailChangeWithPasskeyAction = async (
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const submittedLocale = requireFormLocale(formData.get("locale"));
  const [t, schema] = await Promise.all([
    getMessagesFor(submittedLocale),
    requestEmailChangeWithPasskeyFormSchema(submittedLocale),
  ]);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      currentEmail: "value",
      locale: "value",
      newEmail: "value",
      passkeyCredential: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, {
        fallback: t("storefront.settings.email_change_failed"),
        locale: submittedLocale,
      }),
      ok: false,
    };
  }

  const { currentEmail, locale, newEmail, passkeyCredential, tenantId } =
    parsed.data;
  const accessToken = await requirePublicSession(
    locale,
    SECURITY_SETTINGS_RETURN_TO,
    tenantId
  );
  // An assertion that does not verify is `invalid_argument` on
  // `passkey_credential_json`, not `unauthenticated`, so it stays a form error
  // instead of ending the session.
  const emailChange = await withPublicSessionReauth(
    locale,
    SECURITY_SETTINGS_RETURN_TO,
    () =>
      requestPublicEmailChange(
        tenantId,
        currentEmail,
        newEmail,
        { passkeyCredential },
        accessToken
      ),
    tenantId
  );
  if (!emailChange.ok) {
    return {
      message: emailRefusalMessage(
        t,
        emailChange.emailRefusal,
        t("storefront.settings.email_change_failed")
      ),
      ok: false,
    };
  }

  redirect(
    await buildSecuritySettingsPath(
      locale,
      tenantId,
      "success",
      t("storefront.settings.email_change_requested")
    )
  );
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
        error: t("storefront.auth.errors.password_mismatch"),
        path: ["confirmPassword"],
      })
      // The API refuses this too, on the same grounds. Checking it here is what
      // gives the reader the reason: whatever the RPC rejects comes back as the
      // one message this form has for a refused submission.
      .refine((value) => value.newPassword !== value.currentPassword, {
        error: t("storefront.settings.password_unchanged"),
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
    const errorPath = await buildSecuritySettingsPath(
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
    const errorPath = await buildSecuritySettingsPath(
      locale,
      tenantId,
      "error",
      t("storefront.settings.password_change_failed")
    );
    redirect(errorPath);
  }

  // The change ended the token this request arrived with, so the browser that
  // made it is signed out too unless the replacement the API minted takes the
  // cookie's place before the redirect.
  await writePublicSessionCookie(changed, tenantId);

  const successPath = await buildSecuritySettingsPath(
    locale,
    tenantId,
    "success",
    t("storefront.settings.password_changed")
  );
  redirect(successPath);
};

/** The form of a row in Linked accounts, which links or unlinks one provider. */
const linkedAccountFormSchema = async (locale: Locale) => {
  const tenantId = await tenantIdFormSchema(locale);

  return z.object({
    locale: localeFormSchema,
    provider: z.enum(SIGN_IN_PROVIDERS),
    tenantId,
  });
};

/**
 * Link a provider account to the signed-in reader's: the reader signs in with
 * the provider whose button they pressed, and the callback links the account
 * they signed in to, whatever address it carries.
 */
export const linkIdentityAction = async (formData: FormData): Promise<void> => {
  await assertSameOrigin();
  const submittedLocale = requireFormLocale(formData.get("locale"));
  const [t, schema] = await Promise.all([
    getMessagesFor(submittedLocale),
    linkedAccountFormSchema(submittedLocale),
  ]);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      locale: "value",
      provider: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    const errorPath = await buildSecuritySettingsPath(
      submittedLocale,
      String(formData.get("tenantId") ?? ""),
      "error",
      t("storefront.settings.linked_account_link_failed")
    );
    redirect(errorPath);
  }

  const { locale, provider, tenantId } = parsed.data;
  const accessToken = await requirePublicSession(
    locale,
    SECURITY_SETTINGS_RETURN_TO,
    tenantId
  );
  await sendToProvider({
    accessToken,
    intent: "link",
    locale,
    provider,
    returnTo: SECURITY_SETTINGS_RETURN_TO,
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
    linkedAccountFormSchema(submittedLocale),
  ]);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      locale: "value",
      provider: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    const errorPath = await buildSecuritySettingsPath(
      submittedLocale,
      String(formData.get("tenantId") ?? ""),
      "error",
      t("storefront.settings.linked_account_unlink_failed")
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
    const errorPath = await buildSecuritySettingsPath(
      locale,
      tenantId,
      "error",
      rpcErrorMessage(
        result.error,
        t("storefront.settings.linked_account_unlink_failed"),
        {
          locale,
          overrides: {
            precondition: t("storefront.settings.linked_account_last"),
          },
        }
      )
    );
    redirect(errorPath);
  }

  const successPath = await buildSecuritySettingsPath(
    locale,
    tenantId,
    "success",
    t("storefront.settings.linked_account_unlinked")
  );
  redirect(successPath);
};
