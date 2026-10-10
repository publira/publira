"use server";

import type { Locale } from "@publira/i18n";
import { toQrCodePath } from "@publira/ui-components/qr-code";
import { redirect } from "next/navigation";

import { mfaCodeFormSchema } from "#lib/auth-input";
import { buildLoginPath } from "#lib/auth-shared";
import { assertSameOrigin } from "#lib/csrf";
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import type {
  MfaEnrollmentConfirmState,
  MfaEnrollmentStartState,
  MfaVerifyState,
} from "#lib/mfa-action-state";
import {
  clearMfaChallenge,
  finishMfaChallenge,
  readMfaChallenge,
} from "#lib/mfa-challenge";
import type { MfaChallenge, MfaChallengeKindName } from "#lib/mfa-challenge";
import {
  confirmPlatformMfaEnrollment,
  startPlatformMfaEnrollment,
  verifyPlatformMfa,
} from "#lib/platform-mfa";
import { writePlatformSessionCookie } from "#lib/platform-session-cookie";
import type { PlatformSession } from "#lib/platform-session-cookie";

/**
 * The challenge this Action is spending.
 *
 * A submission with no challenge behind it — the cookie ran out, or was
 * already spent — has nothing left to finish, so it goes back to the sign-in
 * screen rather than reporting a form error the operator cannot act on.
 */
const requireChallenge = async (
  kind: MfaChallengeKindName
): Promise<MfaChallenge> => {
  const challenge = await readMfaChallenge();
  if (!challenge || challenge.kind !== kind) {
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
    return { message: t("platform.auth.mfa.code_required") };
  }
  return { code: parsed.data };
};

/**
 * Take the session the second factor earned, reporting a console-side failure
 * as a message rather than throwing away a step that cannot be repeated.
 */
const storeSession = async (session: PlatformSession): Promise<boolean> => {
  try {
    await writePlatformSessionCookie(session);
    return true;
  } catch (error) {
    // Sealing or writing the cookie broke; the reason is only in the log.
    console.error("[web-platform] mfa session cookie seal failed", error);
    return false;
  }
};

export const verifyMfaAction = async (
  _prevState: MfaVerifyState,
  formData: FormData
): Promise<MfaVerifyState> => {
  await assertSameOrigin();
  const challenge = await requireChallenge("verify");
  const locale = await getPlatformLocale();
  const [t, parsed] = await Promise.all([
    getMessagesFor(locale),
    parseCode(formData, locale),
  ]);
  if ("message" in parsed) {
    return { message: parsed.message, ok: false };
  }

  const result = await verifyPlatformMfa(
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

  const stored = await storeSession(result.session);
  if (!stored) {
    return {
      message: t("platform.auth.login.processing_failed"),
      ok: false,
    };
  }
  // A recovery code is one the operator can never use again, so the screen
  // says so and offers the way back to a full set before moving on.
  if (result.recoveryCodeUsed) {
    await finishMfaChallenge(challenge);
    return {
      message: t("platform.auth.mfa.recovery_used_description", {
        count: result.remainingRecoveryCodes,
      }),
      ok: true,
    };
  }

  await clearMfaChallenge();
  redirect(challenge.nextPath);
};

export const startMfaEnrollmentAction = async (
  _prevState: MfaEnrollmentStartState,
  _formData: FormData
): Promise<MfaEnrollmentStartState> => {
  await assertSameOrigin();
  const challenge = await requireChallenge("enroll");
  const locale = await getPlatformLocale();

  const result = await startPlatformMfaEnrollment(
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
  const challenge = await requireChallenge("enroll");
  const locale = await getPlatformLocale();
  const parsed = await parseCode(formData, locale);
  if ("message" in parsed) {
    return { message: parsed.message, ok: false };
  }

  const result = await confirmPlatformMfaEnrollment(
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

  const signedIn = result.session ? await storeSession(result.session) : false;
  await finishMfaChallenge(challenge);

  return {
    message: "",
    ok: true,
    recoveryCodes: result.recoveryCodes,
    signedIn,
  };
};
