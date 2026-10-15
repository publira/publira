"use server";

import type { Locale } from "@publira/i18n";
import type { FormActionState } from "@publira/ui-components/action-form";
import { toQrCodePath } from "@publira/ui-components/qr-code";
import { updateTag } from "next/cache";

import { getActionLocale } from "#lib/action-messages";
import {
  adminMfaStatusCacheTag,
  beginAdminPasskeyRegistration,
  confirmAdminMfaEnrollment,
  deleteAdminPasskey,
  disableAdminMfa,
  finishAdminPasskeyRegistration,
  regenerateAdminMfaRecoveryCodes,
  renameAdminPasskey,
  startAdminMfaEnrollment,
} from "#lib/admin-mfa";
import {
  mfaCodeFormSchema,
  passkeyCredentialFormSchema,
  passkeyNameFormSchema,
  tenantIdFormSchema,
} from "#lib/auth-input";
import { withAdminSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { flagOneFormSchema, requiredTrimmedString } from "#lib/form-schemas";
import { getMessagesFor } from "#lib/messages";
import type {
  MfaEnrollmentConfirmState,
  MfaEnrollmentStartState,
  MfaRecoveryCodesState,
  PasskeyCeremonyStartState,
  PasskeyRegistrationState,
} from "#lib/mfa-action-state";

/**
 * The operator's own second factor, managed from their account settings.
 *
 * These carry a session rather than a challenge token: the account is already
 * signed in, and the code it presents proves the authenticator rather than the
 * account. `withAdminSessionReauth` is what turns a session the API has since
 * rejected into the login redirect — a refused *code* never reaches it, because
 * `lib/admin-mfa.ts` classifies that as a form message first.
 */

/** The tenant a form names, or the message for a form that names none. */
const parseTenantId = async (
  formData: FormData,
  locale: Locale
): Promise<{ tenantId: string } | { message: string }> => {
  const [t, tenantIdSchema] = await Promise.all([
    getMessagesFor(locale),
    tenantIdFormSchema(locale),
  ]);
  const tenantId = tenantIdSchema.safeParse(formData.get("tenant_id"));
  if (!tenantId.success) {
    return { message: t("admin.settings.tenant_missing") };
  }
  return { tenantId: tenantId.data };
};

/**
 * The passkey a row's form names. A form that names none did not come from
 * the list, so it is answered as a passkey that is not there.
 */
const parsePasskeyForm = async (
  formData: FormData,
  locale: Locale
): Promise<{ id: string; tenantId: string } | { message: string }> => {
  const [t, tenant] = await Promise.all([
    getMessagesFor(locale),
    parseTenantId(formData, locale),
  ]);
  if ("message" in tenant) {
    return tenant;
  }
  const notFound = t("admin.settings.mfa.passkey_not_found");
  const id = requiredTrimmedString(notFound, 64).safeParse(
    formData.get("passkey_id")
  );
  if (!id.success) {
    return { message: notFound };
  }
  return { id: id.data, tenantId: tenant.tenantId };
};

interface MfaFormInput {
  code: string;
  tenantId: string;
}

const parseMfaForm = async (
  formData: FormData,
  locale: Locale
): Promise<MfaFormInput | { message: string }> => {
  const [t, tenant] = await Promise.all([
    getMessagesFor(locale),
    parseTenantId(formData, locale),
  ]);
  if ("message" in tenant) {
    return tenant;
  }

  const code = mfaCodeFormSchema.safeParse(formData.get("code"));
  if (!code.success) {
    return { message: t("admin.auth.mfa.code_required") };
  }

  return { code: code.data, tenantId: tenant.tenantId };
};

export const startAccountMfaEnrollmentAction = async (
  _prevState: MfaEnrollmentStartState,
  formData: FormData
): Promise<MfaEnrollmentStartState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const input = await parseTenantId(formData, locale);
  if ("message" in input) {
    return { message: input.message, ok: false };
  }

  const result = await withAdminSessionReauth(() =>
    startAdminMfaEnrollment(input.tenantId, "", locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  return {
    message: "",
    ok: true,
    qr: toQrCodePath(result.otpauthUri),
    secret: result.secret,
  };
};

export const confirmAccountMfaEnrollmentAction = async (
  _prevState: MfaEnrollmentConfirmState,
  formData: FormData
): Promise<MfaEnrollmentConfirmState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, input] = await Promise.all([
    getMessagesFor(locale),
    parseMfaForm(formData, locale),
  ]);
  if ("message" in input) {
    return { message: input.message, ok: false };
  }

  const result = await withAdminSessionReauth(() =>
    confirmAdminMfaEnrollment(input.tenantId, "", input.code, locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(adminMfaStatusCacheTag(input.tenantId));

  // The session that authorized this call is the session it keeps; only a
  // challenge enrollment issues one, so nothing here changes who is signed in.
  return {
    message: t("admin.settings.mfa.enabled_done"),
    ok: true,
    recoveryCodes: result.recoveryCodes,
    signedIn: true,
  };
};

export const regenerateAccountMfaRecoveryCodesAction = async (
  _prevState: MfaRecoveryCodesState,
  formData: FormData
): Promise<MfaRecoveryCodesState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, input] = await Promise.all([
    getMessagesFor(locale),
    parseMfaForm(formData, locale),
  ]);
  if ("message" in input) {
    return { message: input.message, ok: false };
  }

  const result = await withAdminSessionReauth(() =>
    regenerateAdminMfaRecoveryCodes(input.tenantId, input.code, locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(adminMfaStatusCacheTag(input.tenantId));

  return {
    message: t("admin.settings.mfa.regenerate_done"),
    ok: true,
    recoveryCodes: result.recoveryCodes,
  };
};

export const disableAccountMfaAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, input] = await Promise.all([
    getMessagesFor(locale),
    parseMfaForm(formData, locale),
  ]);
  if ("message" in input) {
    return { message: input.message, ok: false };
  }

  const result = await withAdminSessionReauth(() =>
    disableAdminMfa(input.tenantId, input.code, locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(adminMfaStatusCacheTag(input.tenantId));

  // Only the wording depends on the passkeys the card listed: the API removed
  // the authenticator either way, and the card's status line, read again
  // after `updateTag`, says what is left.
  return {
    message: flagOneFormSchema.parse(formData.get("keeps_passkeys"))
      ? t("admin.settings.mfa.disable_done_with_passkeys")
      : t("admin.settings.mfa.disable_done"),
    ok: true,
  };
};

/**
 * The first half of adding a passkey from the account settings. The browser
 * creates the credential with what this answers and hands it to
 * {@link finishAccountPasskeyRegistrationAction}.
 */
export const beginAccountPasskeyRegistrationAction = async (
  formData: FormData
): Promise<PasskeyCeremonyStartState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const input = await parseTenantId(formData, locale);
  if ("message" in input) {
    return { message: input.message, ok: false };
  }

  const result = await withAdminSessionReauth(() =>
    beginAdminPasskeyRegistration(input.tenantId, "", locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }
  return { message: "", ok: true, optionsJson: result.optionsJson };
};

/**
 * Store the passkey the browser created. The first factor of an account
 * brings its recovery codes, answered here for the card to show once, as an
 * authenticator's enrollment does.
 */
export const finishAccountPasskeyRegistrationAction = async (
  formData: FormData
): Promise<PasskeyRegistrationState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, input] = await Promise.all([
    getMessagesFor(locale),
    parseTenantId(formData, locale),
  ]);
  if ("message" in input) {
    return { message: input.message, ok: false };
  }
  // A submission without a credential did not come from the ceremony, so it
  // is reported the way a ceremony that failed in the browser is.
  const credential = passkeyCredentialFormSchema.safeParse(
    formData.get("credential")
  );
  if (!credential.success) {
    return { message: t("admin.auth.mfa.errors.passkey_failed"), ok: false };
  }

  const result = await withAdminSessionReauth(() =>
    finishAdminPasskeyRegistration(input.tenantId, "", credential.data, locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(adminMfaStatusCacheTag(input.tenantId));

  return {
    message: t("admin.settings.mfa.passkey_added"),
    ok: true,
    passkeyId: result.passkeyId,
    recoveryCodes: result.recoveryCodes,
  };
};

export const renameAccountPasskeyAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, input, nameSchema] = await Promise.all([
    getMessagesFor(locale),
    parsePasskeyForm(formData, locale),
    passkeyNameFormSchema(locale),
  ]);
  if ("message" in input) {
    return { message: input.message, ok: false };
  }
  const name = nameSchema.safeParse(formData.get("name"));
  if (!name.success) {
    return {
      message: name.error.issues[0]?.message ?? "",
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    renameAdminPasskey(input.tenantId, input.id, name.data, locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(adminMfaStatusCacheTag(input.tenantId));

  return { message: t("admin.settings.mfa.passkey_named"), ok: true };
};

export const deleteAccountPasskeyAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, input] = await Promise.all([
    getMessagesFor(locale),
    parsePasskeyForm(formData, locale),
  ]);
  if ("message" in input) {
    return { message: input.message, ok: false };
  }

  const result = await withAdminSessionReauth(() =>
    deleteAdminPasskey(input.tenantId, input.id, locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(adminMfaStatusCacheTag(input.tenantId));

  return { message: t("admin.settings.mfa.passkey_removed"), ok: true };
};
