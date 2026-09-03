/**
 * The half-finished login a correct password earns when the account still owes
 * a second factor.
 *
 * The API answers `Login` with a short-lived challenge token instead of a
 * session, and only the MFA RPCs accept it. The console has to hand that token
 * back to itself across a redirect and a form submission, so it rides in a
 * cookie sealed with the same key as the session cookie: the browser holds it,
 * but cannot read the token or forge a challenge of its own. The URL is
 * deliberately not used — a token in the query string survives in history, in
 * `Referer`, and in whatever the operator pastes into a chat window.
 */

import {
  decryptPayload,
  encryptPayload,
  isSessionExpired,
  resolveAuthSecret,
  sessionCookieOptions,
} from "@publira/web-session";
import { profileCookieName } from "@publira/web-session/cookie-name";
import { cookies } from "next/headers";
import { z } from "zod";

import { sanitizeRedirectPath } from "./admin-auth-shared";
import { isTenantIdFormat } from "./tenant-id-format";

export const MFA_CHALLENGE_COOKIE_NAME = profileCookieName(
  "publira_web_admin_mfa"
);

/** The path `/mfa` serves both challenge kinds from. */
export const MFA_PATH = "/mfa";

/**
 * What the challenge can still complete: a code from an authenticator the
 * account already has, or the enrollment this deployment requires of it.
 */
export const MFA_CHALLENGE_KINDS = ["verify", "enroll"] as const;

export type MfaChallengeKindName = (typeof MFA_CHALLENGE_KINDS)[number];

const mfaChallengeSchema = z.object({
  challengeToken: z.string().trim().min(1),
  expiresAt: z.string().trim().min(1),
  kind: z.enum(MFA_CHALLENGE_KINDS),
  nextPath: z.string().transform(sanitizeRedirectPath),
  tenantId: z.string().trim().refine(isTenantIdFormat),
});

export type MfaChallenge = z.infer<typeof mfaChallengeSchema>;

/**
 * The pending challenge this request carries, or `null` when there is none to
 * act on.
 *
 * A cookie that no longer decrypts, one shaped like something else, and one
 * whose challenge has run out are all the same answer: the operator has to
 * sign in again. Reads `cookies()`, so callers sit inside a `<Suspense>`
 * boundary and never inside a `"use cache"` scope.
 */
export const readMfaChallenge = async (): Promise<MfaChallenge | null> => {
  const cookieStore = await cookies();
  const raw = cookieStore.get(MFA_CHALLENGE_COOKIE_NAME)?.value?.trim();
  if (!raw) {
    return null;
  }

  const payload = await decryptPayload(raw, resolveAuthSecret());
  const parsed = mfaChallengeSchema.safeParse(payload);
  if (!parsed.success || isSessionExpired(parsed.data.expiresAt)) {
    return null;
  }

  return parsed.data;
};

/**
 * Store the challenge for the screens that finish it.
 *
 * **Server Actions only** — writing a cookie needs a response whose headers are
 * still open. The cookie expires with the challenge itself, so a browser left
 * on the code entry screen stops carrying a token the API would refuse anyway.
 */
export const writeMfaChallenge = async (
  challenge: MfaChallenge
): Promise<void> => {
  const cookieStore = await cookies();
  cookieStore.set({
    ...sessionCookieOptions(new Date(challenge.expiresAt)),
    name: MFA_CHALLENGE_COOKIE_NAME,
    value: await encryptPayload(challenge, resolveAuthSecret()),
  });
};

/**
 * Drop the challenge once it has been spent or abandoned.
 *
 * **Server Actions only**, for the same reason as {@link writeMfaChallenge}.
 */
export const clearMfaChallenge = async (): Promise<void> => {
  const cookieStore = await cookies();
  cookieStore.delete(MFA_CHALLENGE_COOKIE_NAME);
};
