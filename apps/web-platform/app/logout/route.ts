import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  PLATFORM_SESSION_COOKIE_NAME,
  logoutPlatform,
  sessionCookieOptions,
} from "../../lib/platform-auth";

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

export const GET = async () => {
  await clearSessionCookie();
  redirect("/login");
};
