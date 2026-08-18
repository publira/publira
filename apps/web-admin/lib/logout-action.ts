"use server";

import { redirect } from "next/navigation";

import { logoutAdmin } from "./admin-auth";
import { clearAdminSessionCookie } from "./auth-session";
import { getAccessToken as getSession } from "./session";

/**
 * Revoke the upstream session, drop the local cookie, and send the user to
 * `/login`. `tenantId` is bound by the layout — `next/root-params` is not
 * available in Server Actions.
 */
export const logoutAction = async (tenantId: string): Promise<void> => {
  const accessToken = await getSession();

  try {
    await logoutAdmin(accessToken, tenantId);
  } catch {
    // Always clear local session cookie, even when upstream revoke fails.
  }

  await clearAdminSessionCookie();
  redirect("/login");
};
