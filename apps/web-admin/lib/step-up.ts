import { sessionCookieOptions } from "@publira/web-session";
import { profileCookieName } from "@publira/web-session/cookie-name";
import { cookies } from "next/headers";

import { withStepUpHeaders } from "./api";
import { toCookieExpires } from "./cookie-expiry";

export const STEP_UP_COOKIE_NAME = profileCookieName(
  "publira_web_admin_step_up"
);

/**
 * Call options for one of the RPCs that ask for a recent re-authentication:
 * the session, and the step-up token this browser last earned on it.
 *
 * The token goes out as the API issued it. One that has expired, or that was
 * earned on another session, is refused by the API with
 * `REAUTHENTICATION_REQUIRED`, the same answer as none at all, so there is
 * nothing to check here.
 */
export const stepUpCallOptions = async (sessionId: string) => {
  const cookieStore = await cookies();

  return withStepUpHeaders(
    sessionId,
    cookieStore.get(STEP_UP_COOKIE_NAME)?.value?.trim() ?? ""
  );
};

/**
 * Keep the step-up token a re-authentication earned, replacing the one before,
 * until the expiry the API gave it.
 *
 * **Server Actions only** — writing a cookie needs a response whose headers
 * are still open.
 */
export const writeStepUpCookie = async (stepUp: {
  expiresAt: Temporal.Instant;
  token: string;
}): Promise<void> => {
  const cookieStore = await cookies();
  cookieStore.set({
    ...sessionCookieOptions(toCookieExpires(stepUp.expiresAt)),
    name: STEP_UP_COOKIE_NAME,
    value: stepUp.token,
  });
};

/**
 * Drop the step-up token with the session it was earned on. The API admits
 * it beside no other session, so this only keeps a dead credential out of
 * the browser.
 *
 * **Server Actions only**, for the same reason as {@link writeStepUpCookie}.
 */
export const clearStepUpCookie = async (): Promise<void> => {
  const cookieStore = await cookies();
  cookieStore.delete(STEP_UP_COOKIE_NAME);
};
