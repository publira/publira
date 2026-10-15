"use server";

import type { Locale } from "@publira/i18n";
import { toQrCodePath } from "@publira/ui-components/qr-code";
import { redirect } from "next/navigation";

import { getActionLocale } from "#lib/action-messages";
import { buildLoginPath } from "#lib/admin-auth-shared";
import {
  beginAdminPasskeyRegistration,
  beginAdminPasskeyVerification,
  confirmAdminMfaEnrollment,
  finishAdminPasskeyRegistration,
  finishAdminPasskeyVerification,
  startAdminMfaEnrollment,
  verifyAdminMfa,
} from "#lib/admin-mfa";
import type { AdminPasskeyCeremonyStartResult } from "#lib/admin-mfa";
import { writeAdminSessionCookie } from "#lib/admin-session-cookie";
import type { AdminSession } from "#lib/admin-session-cookie";
import {
  mfaCodeFormSchema,
  passkeyCredentialFormSchema,
} from "#lib/auth-input";
import { assertSameOrigin } from "#lib/csrf";
import { getMessagesFor } from "#lib/messages";
import type {
  MfaEnrollmentConfirmState,
  MfaEnrollmentStartState,
  MfaVerifyState,
  PasskeyCeremonyStartState,
} from "#lib/mfa-action-state";
import {
  clearMfaChallenge,
  finishMfaChallenge,
  readMfaChallenge,
} from "#lib/mfa-challenge";
import type { MfaChallenge, MfaChallengeKindName } from "#lib/mfa-challenge";

/**
 * The challenge this Action is spending.
 *
 * A submission with no challenge behind it — the cookie ran out, was already
 * spent, or belongs to a different tenant than the form claims — has nothing
 * left to finish, so it goes back to the sign-in screen rather than reporting
 * a form error the operator cannot act on.
 */
const requireChallenge = async (
  formData: FormData,
  kind: MfaChallengeKindName
): Promise<MfaChallenge> => {
  const challenge = await readMfaChallenge();
  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  if (
    !challenge ||
    challenge.kind !== kind ||
    challenge.tenantId !== tenantId
  ) {
    redirect(buildLoginPath(challenge?.nextPath, { revoked: true }));
  }
  return challenge;
};

/** End a challenge the API no longer honours, and ask for the password again. */
const abandonChallenge = async (challenge: MfaChallenge): Promise<never> => {
  await clearMfaChallenge();
  redirect(buildLoginPath(challenge.nextPath, { revoked: true }));
};

const parseCode = async (
  formData: FormData,
  locale: Locale
): Promise<{ code: string } | { message: string }> => {
  const t = await getMessagesFor(locale);
  const parsed = mfaCodeFormSchema.safeParse(formData.get("code"));
  if (!parsed.success) {
    return { message: t("admin.auth.mfa.code_required") };
  }
  return { code: parsed.data };
};

/**
 * The credential the browser's ceremony produced. A submission without one
 * did not come from the passkey form, so it is reported the way a ceremony
 * that failed in the browser is.
 */
const parseCredential = async (
  formData: FormData,
  locale: Locale
): Promise<{ credentialJson: string } | { message: string }> => {
  const t = await getMessagesFor(locale);
  const parsed = passkeyCredentialFormSchema.safeParse(
    formData.get("credential")
  );
  if (!parsed.success) {
    return { message: t("admin.auth.mfa.errors.passkey_failed") };
  }
  return { credentialJson: parsed.data };
};

/**
 * The options a ceremony was begun with, handed to the browser, or the
 * reason it could not begin. A challenge the API no longer honours goes back
 * to the sign-in screen, as it does for a code.
 */
const toCeremonyStartState = async (
  challenge: MfaChallenge,
  result: AdminPasskeyCeremonyStartResult
): Promise<PasskeyCeremonyStartState> => {
  if (!result.ok) {
    if (result.challengeExpired) {
      await abandonChallenge(challenge);
    }
    return { message: result.message, ok: false };
  }
  return { message: "", ok: true, optionsJson: result.optionsJson };
};

/**
 * Take the session the second factor earned, reporting a console-side failure
 * as a message rather than throwing away a step that cannot be repeated.
 */
const storeSession = async (
  tenantId: string,
  session: AdminSession
): Promise<boolean> => {
  try {
    await writeAdminSessionCookie(tenantId, session);
    return true;
  } catch (error) {
    // Sealing or writing the cookie broke; the reason is only in the log.
    console.error("[web-admin] mfa session cookie seal failed", error);
    return false;
  }
};

export const verifyMfaAction = async (
  _prevState: MfaVerifyState,
  formData: FormData
): Promise<MfaVerifyState> => {
  await assertSameOrigin();
  const challenge = await requireChallenge(formData, "verify");
  const locale = await getActionLocale(formData);
  const [t, parsed] = await Promise.all([
    getMessagesFor(locale),
    parseCode(formData, locale),
  ]);
  if ("message" in parsed) {
    return { message: parsed.message, ok: false };
  }

  const result = await verifyAdminMfa(
    challenge.tenantId,
    challenge.challengeToken,
    parsed.code,
    locale
  );
  if (!result.ok) {
    if (result.challengeExpired) {
      await abandonChallenge(challenge);
    }
    return { message: result.message, ok: false };
  }

  const stored = await storeSession(challenge.tenantId, result.session);
  if (!stored) {
    return {
      message: t("admin.auth.errors.login_processing_failed"),
      ok: false,
    };
  }
  // A recovery code is one the account can never use again, so the screen says
  // so and offers the way back to a full set before moving on.
  if (result.recoveryCodeUsed) {
    await finishMfaChallenge(challenge);
    return {
      message: t("admin.auth.mfa.recovery_used_description", {
        count: result.remainingRecoveryCodes,
      }),
      ok: true,
    };
  }

  await clearMfaChallenge();
  redirect(challenge.nextPath);
};

/**
 * The first half of answering a verify challenge with a passkey. The browser
 * runs the ceremony with what this answers and hands the result to
 * {@link finishPasskeyVerificationAction}.
 */
export const beginPasskeyVerificationAction = async (
  formData: FormData
): Promise<PasskeyCeremonyStartState> => {
  await assertSameOrigin();
  const challenge = await requireChallenge(formData, "verify");
  const locale = await getActionLocale(formData);

  return toCeremonyStartState(
    challenge,
    await beginAdminPasskeyVerification(
      challenge.tenantId,
      challenge.challengeToken,
      locale
    )
  );
};

/**
 * Exchange the assertion the browser made for the session. A passkey spends
 * no recovery code, so there is nothing for `/mfa` to say afterwards and the
 * login goes straight on, as an authenticator code's does.
 */
export const finishPasskeyVerificationAction = async (
  formData: FormData
): Promise<MfaVerifyState> => {
  await assertSameOrigin();
  const challenge = await requireChallenge(formData, "verify");
  const locale = await getActionLocale(formData);
  const [t, parsed] = await Promise.all([
    getMessagesFor(locale),
    parseCredential(formData, locale),
  ]);
  if ("message" in parsed) {
    return { message: parsed.message, ok: false };
  }

  const result = await finishAdminPasskeyVerification(
    challenge.tenantId,
    challenge.challengeToken,
    parsed.credentialJson,
    locale
  );
  if (!result.ok) {
    if (result.challengeExpired) {
      await abandonChallenge(challenge);
    }
    return { message: result.message, ok: false };
  }

  const stored = await storeSession(challenge.tenantId, result.session);
  if (!stored) {
    return {
      message: t("admin.auth.errors.login_processing_failed"),
      ok: false,
    };
  }

  await clearMfaChallenge();
  redirect(challenge.nextPath);
};

export const startMfaEnrollmentAction = async (
  _prevState: MfaEnrollmentStartState,
  formData: FormData
): Promise<MfaEnrollmentStartState> => {
  await assertSameOrigin();
  const challenge = await requireChallenge(formData, "enroll");
  const locale = await getActionLocale(formData);

  const result = await startAdminMfaEnrollment(
    challenge.tenantId,
    challenge.challengeToken,
    locale
  );
  if (!result.ok) {
    if (result.challengeExpired) {
      await abandonChallenge(challenge);
    }
    return { message: result.message, ok: false };
  }

  return {
    message: "",
    ok: true,
    qr: toQrCodePath(result.otpauthUri),
    secret: result.secret,
  };
};

export const confirmMfaEnrollmentAction = async (
  _prevState: MfaEnrollmentConfirmState,
  formData: FormData
): Promise<MfaEnrollmentConfirmState> => {
  await assertSameOrigin();
  const challenge = await requireChallenge(formData, "enroll");
  const locale = await getActionLocale(formData);
  const parsed = await parseCode(formData, locale);
  if ("message" in parsed) {
    return { message: parsed.message, ok: false };
  }

  const result = await confirmAdminMfaEnrollment(
    challenge.tenantId,
    challenge.challengeToken,
    parsed.code,
    locale
  );
  if (!result.ok) {
    if (result.challengeExpired) {
      await abandonChallenge(challenge);
    }
    return { message: result.message, ok: false };
  }

  const signedIn = result.session
    ? await storeSession(challenge.tenantId, result.session)
    : false;
  await finishMfaChallenge(challenge);

  return {
    message: "",
    ok: true,
    recoveryCodes: result.recoveryCodes,
    signedIn,
  };
};

/**
 * The first half of enrolling a passkey where the tenant requires a second
 * factor. The browser creates the credential with what this answers and hands
 * it to {@link finishPasskeyRegistrationAction}.
 */
export const beginPasskeyRegistrationAction = async (
  formData: FormData
): Promise<PasskeyCeremonyStartState> => {
  await assertSameOrigin();
  const challenge = await requireChallenge(formData, "enroll");
  const locale = await getActionLocale(formData);

  return toCeremonyStartState(
    challenge,
    await beginAdminPasskeyRegistration(
      challenge.tenantId,
      challenge.challengeToken,
      locale
    )
  );
};

/**
 * Store the passkey the browser created. It ends the enrollment the way
 * confirming an authenticator does: the session is taken and the recovery
 * codes it came with are answered for `/mfa` to show once.
 */
export const finishPasskeyRegistrationAction = async (
  formData: FormData
): Promise<MfaEnrollmentConfirmState> => {
  await assertSameOrigin();
  const challenge = await requireChallenge(formData, "enroll");
  const locale = await getActionLocale(formData);
  const parsed = await parseCredential(formData, locale);
  if ("message" in parsed) {
    return { message: parsed.message, ok: false };
  }

  const result = await finishAdminPasskeyRegistration(
    challenge.tenantId,
    challenge.challengeToken,
    parsed.credentialJson,
    locale
  );
  if (!result.ok) {
    if (result.challengeExpired) {
      await abandonChallenge(challenge);
    }
    return { message: result.message, ok: false };
  }

  const signedIn = result.session
    ? await storeSession(challenge.tenantId, result.session)
    : false;
  await finishMfaChallenge(challenge);

  return {
    message: "",
    ok: true,
    recoveryCodes: result.recoveryCodes,
    signedIn,
  };
};
