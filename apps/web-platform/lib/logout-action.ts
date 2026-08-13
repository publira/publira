"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { resolveAccessToken as getSession } from "./api-client";
import { PLATFORM_SESSION_COOKIE_NAME, logoutPlatform } from "./auth";

/**
 * Revoke the upstream session, drop the local cookie, and send the user to
 * `/login`.
 */
export const logoutAction = async (): Promise<void> => {
  const accessToken = await getSession();

  try {
    await logoutPlatform(accessToken);
  } catch {
    // Always clear local session cookie, even when upstream revoke fails.
  }

  const cookieStore = await cookies();
  cookieStore.delete(PLATFORM_SESSION_COOKIE_NAME);
  redirect("/login");
};
