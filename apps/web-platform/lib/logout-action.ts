"use server";

import { redirect } from "next/navigation";

import { resolveAccessToken as getSession } from "./api-client";
import { logoutPlatform } from "./auth";
import { clearPlatformSessionCookie } from "./auth-session";
import { assertSameOrigin } from "./csrf";

/**
 * Revoke the upstream session, drop the local cookie, and send the user to
 * `/login`.
 */
export const logoutAction = async (): Promise<void> => {
  await assertSameOrigin();
  const accessToken = await getSession();

  try {
    await logoutPlatform(accessToken);
  } catch {
    // Always clear local session cookie, even when upstream revoke fails.
  }

  await clearPlatformSessionCookie();
  redirect("/login");
};
