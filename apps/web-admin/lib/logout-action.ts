"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ADMIN_SESSION_COOKIE_NAME, logoutAdmin } from "./admin-auth";
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

  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_SESSION_COOKIE_NAME);
  redirect("/login");
};
