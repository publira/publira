"use server";

import type { Locale } from "@publira/i18n";
import type { FormActionState } from "@publira/ui-components/action-form";
import { toQrCodePath } from "@publira/ui-components/qr-code";
import { updateTag } from "next/cache";

import { mfaCodeFormSchema } from "#lib/auth-input";
import { withPlatformSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import type {
  MfaEnrollmentConfirmState,
  MfaEnrollmentStartState,
  MfaRecoveryCodesState,
} from "#lib/mfa-action-state";
import {
  confirmPlatformMfaEnrollment,
  disablePlatformMfa,
  PLATFORM_MFA_STATUS_CACHE_TAG,
  regeneratePlatformMfaRecoveryCodes,
  startPlatformMfaEnrollment,
} from "#lib/platform-mfa";

/**
 * The operator's own second factor, managed from their account settings.
 *
 * These carry a session rather than a challenge token: the operator is
 * already signed in, and the code it presents proves the authenticator rather
 * than the operator. `withPlatformSessionReauth` is what turns a session the
 * API has since rejected into the sign-in redirect — a refused *code* never
 * reaches it, because `lib/platform-mfa.ts` classifies that as a form message
 * first.
 */

const parseCode = async (
  formData: FormData,
  locale: Locale
): Promise<{ code: string } | { message: string }> => {
  const t = await getMessagesFor(locale);
  const code = mfaCodeFormSchema.safeParse(formData.get("code"));
  if (!code.success) {
    return { message: t("platform.auth.mfa.code_required") };
  }
  return { code: code.data };
};

export const startAccountMfaEnrollmentAction = async (
  _prevState: MfaEnrollmentStartState,
  _formData: FormData
): Promise<MfaEnrollmentStartState> => {
  await assertSameOrigin();
  const locale = await getPlatformLocale();

  const result = await withPlatformSessionReauth(() =>
    startPlatformMfaEnrollment("", locale)
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
  const locale = await getPlatformLocale();
  const [t, input] = await Promise.all([
    getMessagesFor(locale),
    parseCode(formData, locale),
  ]);
  if ("message" in input) {
    return { message: input.message, ok: false };
  }

  const result = await withPlatformSessionReauth(() =>
    confirmPlatformMfaEnrollment("", input.code, locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(PLATFORM_MFA_STATUS_CACHE_TAG);

  // The session that authorized this call is the session it keeps; only a
  // challenge enrollment issues one, so nothing here changes who is signed in.
  return {
    message: t("platform.settings.mfa.enabled_done"),
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
  const locale = await getPlatformLocale();
  const [t, input] = await Promise.all([
    getMessagesFor(locale),
    parseCode(formData, locale),
  ]);
  if ("message" in input) {
    return { message: input.message, ok: false };
  }

  const result = await withPlatformSessionReauth(() =>
    regeneratePlatformMfaRecoveryCodes(input.code, locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(PLATFORM_MFA_STATUS_CACHE_TAG);

  return {
    message: t("platform.settings.mfa.regenerate_done"),
    ok: true,
    recoveryCodes: result.recoveryCodes,
  };
};

export const disableAccountMfaAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getPlatformLocale();
  const [t, input] = await Promise.all([
    getMessagesFor(locale),
    parseCode(formData, locale),
  ]);
  if ("message" in input) {
    return { message: input.message, ok: false };
  }

  const result = await withPlatformSessionReauth(() =>
    disablePlatformMfa(input.code, locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(PLATFORM_MFA_STATUS_CACHE_TAG);

  return {
    message: t("platform.settings.mfa.disable_done"),
    ok: true,
  };
};
