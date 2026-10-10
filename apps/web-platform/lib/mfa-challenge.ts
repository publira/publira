/**
 * The half-finished sign-in a correct password earns when the operator still
 * owes a second factor.
 *
 * The API answers `Login` with a short-lived challenge token instead of a
 * session, and only the MFA RPCs accept it. The console has to hand that token
 * back to itself across a redirect and a form submission, so it rides in a
 * cookie sealed with the same key as the session cookie: the browser holds it,
 * but cannot read the token or forge a challenge of its own. The URL is
 * deliberately not used — a token in the query string survives in history, in
 * `Referer`, and in whatever the operator pastes into a chat window.
 */

import { parseInstant } from "@publira/utils";
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

import { sanitizeRedirectPath } from "./auth-shared";
import { toCookieExpires } from "./cookie-expiry";

export const MFA_CHALLENGE_COOKIE_NAME = profileCookieName(
  "publira_web_platform_mfa"
);

/** The path `/mfa` serves both challenge kinds from. */
export const MFA_PATH = "/mfa";

/**
 * What the challenge can still complete: a code from an authenticator the
 * operator already has, or the enrollment the platform policy requires.
 */
export const MFA_CHALLENGE_KINDS = ["verify", "enroll"] as const;

export type MfaChallengeKindName = (typeof MFA_CHALLENGE_KINDS)[number];

const mfaChallengeSchema = z.object({
  challengeToken: z.string().trim().min(1),
  // An expiry that is not an instant is no expiry: a stored challenge whose
  // deadline cannot be read is refused rather than treated as still valid.
  expiresAt: z
    .string()
    .trim()
    .refine((value) => parseInstant(value) !== null),
  kind: z.enum(MFA_CHALLENGE_KINDS),
  nextPath: z.string().transform(sanitizeRedirectPath),
});

export type MfaChallenge = z.infer<typeof mfaChallengeSchema>;

/**
 * A challenge the operator has spent, kept without its token until it expires.
 *
 * Writing the session cookie makes Next.js render `/mfa` again in the Action's
 * own response, and that render needs the challenge's kind and destination to
 * keep showing the answer the Action returned: the recovery codes an
 * enrollment issued, or how many codes a recovery sign-in left.
 */
const finishedMfaChallengeSchema = mfaChallengeSchema
  .omit({ challengeToken: true })
  .extend({ finished: z.literal(true) });

const storedMfaChallengeSchema = z.union([
  mfaChallengeSchema,
  finishedMfaChallengeSchema,
]);

export type StoredMfaChallenge = z.infer<typeof storedMfaChallengeSchema>;

/**
 * The challenge this request carries, pending or finished, or `null` when there
 * is none.
 *
 * A cookie that no longer decrypts, one shaped like something else, and one
 * whose challenge has run out are all the same answer: the operator has to
 * sign in again. Reads `cookies()`, so callers sit inside a `<Suspense>`
 * boundary and never inside a `"use cache"` scope.
 */
export const readStoredMfaChallenge =
  async (): Promise<StoredMfaChallenge | null> => {
    const cookieStore = await cookies();
    const raw = cookieStore.get(MFA_CHALLENGE_COOKIE_NAME)?.value?.trim();
    if (!raw) {
      return null;
    }

    const payload = await decryptPayload(raw, resolveAuthSecret());
    const parsed = storedMfaChallengeSchema.safeParse(payload);
    if (!parsed.success || isSessionExpired(parsed.data.expiresAt)) {
      return null;
    }

    return parsed.data;
  };

/** The pending challenge this request carries, or `null` when there is none to act on. */
export const readMfaChallenge = async (): Promise<MfaChallenge | null> => {
  const stored = await readStoredMfaChallenge();
  return stored && "challengeToken" in stored ? stored : null;
};

/**
 * Store the challenge for the screens that finish it.
 *
 * **Server Actions only** — writing a cookie needs a response whose headers are
 * still open. The cookie expires with the challenge itself, so a browser left
 * on the code entry screen stops carrying a token the API would refuse anyway.
 */
export const writeMfaChallenge = async (
  challenge: StoredMfaChallenge
): Promise<void> => {
  const expiresAt = parseInstant(challenge.expiresAt);
  if (!expiresAt) {
    // The caller built this from a timestamp the API just answered, so a value
    // that is not an instant is a bug here rather than a challenge to store
    // without knowing when it stops being one.
    throw new Error("mfa challenge expiry is not an instant");
  }

  const sealed = await encryptPayload(challenge, resolveAuthSecret());
  const cookieStore = await cookies();
  cookieStore.set({
    ...sessionCookieOptions(toCookieExpires(expiresAt)),
    name: MFA_CHALLENGE_COOKIE_NAME,
    value: sealed,
  });
};

/**
 * Mark the challenge spent by a submission whose answer `/mfa` still has to
 * show, dropping the token the API will not accept again.
 *
 * **Server Actions only**, for the same reason as {@link writeMfaChallenge}.
 */
export const finishMfaChallenge = async ({
  challengeToken: _spent,
  ...challenge
}: MfaChallenge): Promise<void> => {
  await writeMfaChallenge({ ...challenge, finished: true });
};

/**
 * Drop the challenge once it has been abandoned, or spent by a submission that
 * leaves `/mfa`.
 *
 * **Server Actions only**, for the same reason as {@link writeMfaChallenge}.
 */
export const clearMfaChallenge = async (): Promise<void> => {
  const cookieStore = await cookies();
  cookieStore.delete(MFA_CHALLENGE_COOKIE_NAME);
};
