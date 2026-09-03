"use server";

import { getMessage } from "@publira/i18n";
import { redirect } from "next/navigation";

import { getActionLocale } from "#lib/action-messages";
import { buildLoginPath } from "#lib/admin-auth-shared";
import {
  confirmAdminMfaEnrollment,
  startAdminMfaEnrollment,
  verifyAdminMfa,
} from "#lib/admin-mfa";
import { writeAdminSessionCookie } from "#lib/admin-session-cookie";
import type { AdminSession } from "#lib/admin-session-cookie";
import { mfaCodeFormSchema } from "#lib/auth-input";
import { assertSameOrigin } from "#lib/csrf";
import { loadAdminMessages } from "#lib/locale";
import type { AdminMessages } from "#lib/locale";
import type {
  MfaEnrollmentConfirmState,
  MfaEnrollmentStartState,
  MfaVerifyState,
} from "#lib/mfa-action-state";
import { clearMfaChallenge, readMfaChallenge } from "#lib/mfa-challenge";
import type { MfaChallenge, MfaChallengeKindName } from "#lib/mfa-challenge";
import { toQrCodePath } from "#lib/qr-code";

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

const parseCode = (
  formData: FormData,
  messages: AdminMessages
): { code: string } | { message: string } => {
  const parsed = mfaCodeFormSchema.safeParse(formData.get("code"));
  if (!parsed.success) {
    return { message: getMessage(messages, "admin.auth.mfa.code_required") };
  }
  return { code: parsed.data };
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
  const messages = await loadAdminMessages(locale);

  const parsed = parseCode(formData, messages);
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
      message: getMessage(
        messages,
        "admin.auth.errors.login_processing_failed"
      ),
      ok: false,
    };
  }
  await clearMfaChallenge();

  // A recovery code is one the account can never use again, so the screen says
  // so and offers the way back to a full set before moving on.
  if (result.recoveryCodeUsed) {
    return { ok: true, remainingRecoveryCodes: result.remainingRecoveryCodes };
  }

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
  const messages = await loadAdminMessages(locale);

  const parsed = parseCode(formData, messages);
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
  await clearMfaChallenge();

  return { ok: true, recoveryCodes: result.recoveryCodes, signedIn };
};
