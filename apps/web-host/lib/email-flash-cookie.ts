import { cookies } from "next/headers";
import { z } from "zod";

/**
 * Destination email after password reset / signup. Carried as a short-lived
 * cookie so the address never appears in the URL (logs, history, Referer).
 *
 * The destination page can only read the cookie: Server Components cannot
 * delete it. `maxAge` is the consume window. Attributes follow #600.
 */
export const RESET_PASSWORD_REQUESTED_EMAIL_COOKIE =
  "publira_web_host_reset_password_email";
export const SIGNUP_PENDING_EMAIL_COOKIE =
  "publira_web_host_signup_pending_email";

export type EmailFlashCookieName =
  | typeof RESET_PASSWORD_REQUESTED_EMAIL_COOKIE
  | typeof SIGNUP_PENDING_EMAIL_COOKIE;

export const EMAIL_FLASH_COOKIE_MAX_AGE_SECONDS = 60;

export const emailFlashCookieOptions = {
  httpOnly: true,
  maxAge: EMAIL_FLASH_COOKIE_MAX_AGE_SECONDS,
  path: "/",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};

export const parseEmailFlashValue = (raw?: string): string => {
  const parsed = z.email().safeParse(raw?.trim() ?? "");
  return parsed.success ? parsed.data : "";
};

export const setEmailFlashCookie = async (
  name: EmailFlashCookieName,
  email: string
): Promise<void> => {
  const cookieStore = await cookies();
  cookieStore.set({
    ...emailFlashCookieOptions,
    name,
    value: email,
  });
};

export const readEmailFlashCookie = async (
  name: EmailFlashCookieName
): Promise<string> => {
  const cookieStore = await cookies();
  return parseEmailFlashValue(cookieStore.get(name)?.value);
};
