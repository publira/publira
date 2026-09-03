"use server";

import { getMessage } from "@publira/i18n";
import type { FormActionState } from "@publira/ui-components/action-form";
import { updateTag } from "next/cache";

import { getActionLocale } from "#lib/action-messages";
import {
  adminMfaStatusCacheTag,
  confirmAdminMfaEnrollment,
  disableAdminMfa,
  regenerateAdminMfaRecoveryCodes,
  startAdminMfaEnrollment,
} from "#lib/admin-mfa";
import { mfaCodeFormSchema, tenantIdFormSchema } from "#lib/auth-input";
import { withAdminSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { loadAdminMessages } from "#lib/locale";
import type { AdminMessages } from "#lib/locale";
import type {
  MfaEnrollmentConfirmState,
  MfaEnrollmentStartState,
  MfaRecoveryCodesState,
} from "#lib/mfa-action-state";
import { toQrCodePath } from "#lib/qr-code";

/**
 * The operator's own second factor, managed from their account settings.
 *
 * These carry a session rather than a challenge token: the account is already
 * signed in, and the code it presents proves the authenticator rather than the
 * account. `withAdminSessionReauth` is what turns a session the API has since
 * rejected into the login redirect — a refused *code* never reaches it, because
 * `lib/admin-mfa.ts` classifies that as a form message first.
 */

interface MfaFormInput {
  code: string;
  tenantId: string;
}

const parseMfaForm = (
  formData: FormData,
  messages: AdminMessages
): MfaFormInput | { message: string } => {
  const tenantId = tenantIdFormSchema(messages).safeParse(
    formData.get("tenant_id")
  );
  if (!tenantId.success) {
    return { message: getMessage(messages, "admin.settings.tenant_missing") };
  }

  const code = mfaCodeFormSchema.safeParse(formData.get("code"));
  if (!code.success) {
    return { message: getMessage(messages, "admin.auth.mfa.code_required") };
  }

  return { code: code.data, tenantId: tenantId.data };
};

export const startAccountMfaEnrollmentAction = async (
  _prevState: MfaEnrollmentStartState,
  formData: FormData
): Promise<MfaEnrollmentStartState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const messages = await loadAdminMessages(locale);

  const tenantId = tenantIdFormSchema(messages).safeParse(
    formData.get("tenant_id")
  );
  if (!tenantId.success) {
    return {
      message: getMessage(messages, "admin.settings.tenant_missing"),
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    startAdminMfaEnrollment(tenantId.data, "", locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  return {
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
  const messages = await loadAdminMessages(locale);

  const input = parseMfaForm(formData, messages);
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
  return { ok: true, recoveryCodes: result.recoveryCodes, signedIn: true };
};

export const regenerateAccountMfaRecoveryCodesAction = async (
  _prevState: MfaRecoveryCodesState,
  formData: FormData
): Promise<MfaRecoveryCodesState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const messages = await loadAdminMessages(locale);

  const input = parseMfaForm(formData, messages);
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
    message: getMessage(messages, "admin.settings.mfa.regenerate_done"),
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
  const messages = await loadAdminMessages(locale);

  const input = parseMfaForm(formData, messages);
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

  return {
    message: getMessage(messages, "admin.settings.mfa.disable_done"),
    ok: true,
  };
};
