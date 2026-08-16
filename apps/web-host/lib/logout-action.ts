"use server";

import { redirect } from "next/navigation";

import { resolveAccessToken as getSession } from "./api-client";
import { logoutPublic } from "./auth";
import { clearPublicSessionCookie } from "./auth-session";

/**
 * Revoke the upstream session, drop the local cookie, and send the user to
 * `/login`. `tenantId` is bound by the layout — `next/root-params` is not
 * available in Server Actions.
 */
export const logoutAction = async (tenantId: string): Promise<void> => {
  const accessToken = await getSession();

  try {
    await logoutPublic(accessToken, tenantId);
  } catch {
    // Always clear local session cookie, even when upstream revoke fails.
  }

  await clearPublicSessionCookie();
  redirect("/login");
};
