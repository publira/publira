import { loginDeviceCookie } from "@publira/web-session";
import type { LoginDevice } from "@publira/web-session";
import { profileCookieName } from "@publira/web-session/cookie-name";
import { cookies } from "next/headers";

export const LOGIN_DEVICE_COOKIE_NAME = profileCookieName(
  "publira_web_admin_login_device"
);

/**
 * The login device token this browser was issued when it last signed in with
 * a right password, or an empty string when it holds none.
 *
 * Sent as-is with the next password sign-in: one that has expired, or that
 * belongs to another address, is treated by the API as absent, so there is
 * nothing to check here.
 */
export const readLoginDeviceToken = async (): Promise<string> => {
  const cookieStore = await cookies();

  return cookieStore.get(LOGIN_DEVICE_COOKIE_NAME)?.value?.trim() ?? "";
};

/**
 * Keep the device a password sign-in was issued, replacing the one before.
 *
 * **Server Actions only** — writing a cookie needs a response whose headers
 * are still open. `null`, a response from a server that issues none, leaves
 * the cookie alone. Signing out never clears it: the token has to outlive the
 * session for the next sign-in from this browser to count as its own. A write
 * that fails is logged rather than thrown, since the sign-in it came with
 * stands without it.
 */
export const writeLoginDeviceCookie = async (
  device: LoginDevice | null
): Promise<void> => {
  if (!device) {
    return;
  }

  try {
    const cookieStore = await cookies();
    cookieStore.set(loginDeviceCookie(LOGIN_DEVICE_COOKIE_NAME, device));
  } catch (error) {
    console.error("[web-admin] login device cookie write failed", error);
  }
};
