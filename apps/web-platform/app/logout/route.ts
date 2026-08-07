import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  PLATFORM_SESSION_COOKIE_NAME,
  logoutPlatform,
  sessionCookieOptions,
} from "#lib/auth";

const clearSessionCookie = async () => {
  const cookieStore = await cookies();
  cookieStore.set({
    ...sessionCookieOptions,
    expires: new Date(0),
    name: PLATFORM_SESSION_COOKIE_NAME,
    value: "",
  });
};

export const POST = async () => {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(PLATFORM_SESSION_COOKIE_NAME)?.value ?? "";

  try {
    await logoutPlatform(sessionId);
  } catch {
    // Always clear local session cookie, even when upstream revoke fails.
  }

  await clearSessionCookie();
  redirect("/login");
};

// Local cookie clear only (no upstream revoke). Kept for direct navigation /
// form GET fallbacks; CSRF risk is limited to clearing the browser cookie.
// oxlint-disable-next-line react-doctor/nextjs-no-side-effect-in-get-handler
export const GET = async () => {
  await clearSessionCookie();
  redirect("/login");
};
