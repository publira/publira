import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  ADMIN_SESSION_COOKIE_NAME,
  logoutAdmin,
  sessionCookieOptions,
} from "#lib/admin-auth";

interface RouteContext {
  params: Promise<{ tenant_id: string }>;
}

const clearSessionCookie = async () => {
  const cookieStore = await cookies();
  cookieStore.set({
    ...sessionCookieOptions,
    expires: new Date(0),
    name: ADMIN_SESSION_COOKIE_NAME,
    value: "",
  });
};

export const POST = async (_request: Request, { params }: RouteContext) => {
  const { tenant_id: tenantId } = await params;

  const { getAccessToken } = await import("#lib/session");
  const accessToken = await getAccessToken();

  try {
    await logoutAdmin(accessToken, tenantId);
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
