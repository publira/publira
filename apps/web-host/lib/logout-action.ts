"use server";

import { updateTag } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { resolveAccessToken as getSession } from "./api-client";
import { PUBLIC_SESSION_COOKIE_NAME, logoutPublic } from "./auth";
import { getPublicSessionCacheTag } from "./auth-shared";

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

  const cookieStore = await cookies();
  cookieStore.delete(PUBLIC_SESSION_COOKIE_NAME);
  updateTag(getPublicSessionCacheTag(PUBLIC_SESSION_COOKIE_NAME));
  redirect("/login");
};
