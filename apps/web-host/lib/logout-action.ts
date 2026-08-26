"use server";

import type { Locale } from "@publira/utils/i18n";
import { redirect } from "next/navigation";

import { resolveAccessToken as getSession } from "./api-client";
import { logoutPublic } from "./auth";
import { clearPublicSessionCookie } from "./auth-session";
import { withLocalePrefix } from "./locale-path";

/**
 * Revoke the upstream session, drop the local cookie, and send the user to
 * `/{locale}/login`. `tenantId` and `locale` are both bound by the layout —
 * `next/root-params` is not available in Server Actions.
 */
export const logoutAction = async (
  tenantId: string,
  locale: Locale
): Promise<void> => {
  const accessToken = await getSession();

  try {
    await logoutPublic(accessToken, tenantId);
  } catch {
    // Always clear local session cookie, even when upstream revoke fails.
  }

  await clearPublicSessionCookie();
  redirect(withLocalePrefix(locale, "/login"));
};
