import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  ADMIN_SESSION_COOKIE_NAME,
  logoutAdmin,
  sessionCookieOptions,
} from "#lib/admin-auth";

const clearSessionCookie = async () => {
  const cookieStore = await cookies();
  cookieStore.set({
    ...sessionCookieOptions,
    expires: new Date(0),
    name: ADMIN_SESSION_COOKIE_NAME,
    value: "",
  });
};

export const POST = async (
  _request: Request,
  { params }: RouteContext<"/[tenant_id]/logout">
) => {
  // params and the session module load are independent of each other.
  const [{ tenant_id: tenantId }, { getAccessToken }] = await Promise.all([
    params,
    import("#lib/session"),
  ]);
  const accessToken = await getAccessToken();

  try {
    await logoutAdmin(accessToken, tenantId);
  } catch {
    // Always clear local session cookie, even when upstream revoke fails.
  }

  // Clear cookie only after the revoke attempt so local session is dropped last.
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
