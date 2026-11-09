/**
 * The sign-in a right password, or a provider's sign-in, leaves half-finished
 * for an account that holds an authenticator, waiting for the code step.
 *
 * The API answers with a short-lived challenge token instead of a session,
 * and the site has to hand that token back to itself across a redirect and a
 * form submission, so it rides in a cookie sealed with the session key: the
 * browser holds it, but can neither read the token nor forge a challenge of
 * its own. The address is deliberately not used, since a token in the query
 * survives in history, in `Referer`, and in whatever a reader pastes.
 */

import type { Locale } from "@publira/i18n";
import { parseInstant } from "@publira/utils";
import {
  decryptPayload,
  encryptPayload,
  isSessionExpired,
  resolveAuthSecret,
} from "@publira/web-session";
import { profileCookieName } from "@publira/web-session/cookie-name";
import { cookies } from "next/headers";
import { z } from "zod";

import { returnToFormSchema } from "./auth-input";
import { localeFormSchema } from "./locale-form";
import { isTenantIdFormat } from "./tenant-id-format";

export const MFA_CHALLENGE_COOKIE_NAME = profileCookieName(
  "publira_web_storefront_mfa"
);

/** The bare path of the code step, which every locale serves. */
export const MFA_CHALLENGE_PATH = "/login/two-step";

const mfaChallengeSchema = z.object({
  challengeToken: z.string().trim().min(1),
  // An expiry that is not an instant is no expiry: a stored challenge whose
  // deadline cannot be read is refused rather than treated as still valid.
  expiresAt: z
    .string()
    .trim()
    .refine((value) => parseInstant(value) !== null),
  locale: localeFormSchema,
  returnTo: returnToFormSchema,
  tenantId: z.string().trim().refine(isTenantIdFormat),
});

export interface MfaChallengeCookie {
  challengeToken: string;
  /** RFC 3339: when the API stops taking the token. */
  expiresAt: string;
  /** The language the sign-in was made in, which the code step keeps. */
  locale: Locale;
  /** Where the reader was heading, locale-less, as `returnTo` always is. */
  returnTo: string;
  tenantId: string;
}

/**
 * The challenge this request carries, or `null` when there is none to act
 * on. A cookie that no longer decrypts, one shaped like something else, and
 * one whose challenge has run out are all the same answer: the reader signs
 * in again.
 */
export const readMfaChallenge =
  async (): Promise<MfaChallengeCookie | null> => {
    const cookieStore = await cookies();
    const raw = cookieStore.get(MFA_CHALLENGE_COOKIE_NAME)?.value?.trim();

    if (!raw) {
      return null;
    }

    const parsed = mfaChallengeSchema.safeParse(
      await decryptPayload(raw, resolveAuthSecret())
    );

    if (!parsed.success || isSessionExpired(parsed.data.expiresAt)) {
      return null;
    }

    return parsed.data;
  };

/**
 * Keep the challenge for the code step. The cookie lives as long as the
 * challenge does, so a browser left on the code step stops carrying a token
 * the API would refuse anyway.
 *
 * Callable from a Server Action and from a Route Handler, the two places a
 * sign-in finishes; neither leaves a client cache behind that names the
 * cookie, so no cache tag is touched.
 */
export const writeMfaChallenge = async (
  challenge: MfaChallengeCookie
): Promise<void> => {
  const expiresAt = parseInstant(challenge.expiresAt);

  if (!expiresAt) {
    // The caller built this from a challenge `toPublicMfaChallenge` accepted,
    // so an expiry that is not an instant is a bug here.
    throw new Error("mfa challenge expiry is not an instant");
  }

  const maxAge = Math.max(
    0,
    Math.floor(
      Temporal.Now.instant().until(expiresAt).total({ unit: "seconds" })
    )
  );

  const sealed = await encryptPayload(challenge, resolveAuthSecret());
  const cookieStore = await cookies();
  cookieStore.set({
    httpOnly: true,
    maxAge,
    name: MFA_CHALLENGE_COOKIE_NAME,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    value: sealed,
  });
};

/**
 * Drop the challenge, once it bought a session or is over.
 *
 * **Server Actions and Route Handlers only**, since a cookie is written to a
 * response whose headers are still open.
 */
export const clearMfaChallenge = async (): Promise<void> => {
  const cookieStore = await cookies();
  cookieStore.delete(MFA_CHALLENGE_COOKIE_NAME);
};
