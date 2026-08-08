import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  PUBLIC_SESSION_COOKIE_NAME,
  logoutPublic,
  sessionCookieOptions,
} from "#lib/auth";
import { getPublicSessionCacheTag } from "#lib/auth-shared";

const clearSessionCookie = (response: NextResponse) => {
  response.cookies.set({
    ...sessionCookieOptions,
    expires: new Date(0),
    name: PUBLIC_SESSION_COOKIE_NAME,
    value: "",
  });
};

export const POST = async (
  request: NextRequest,
  { params }: RouteContext<"/[tenant_id]/logout">
) => {
  const { tenant_id: tenantId } = await params;

  const sessionId =
    request.cookies.get(PUBLIC_SESSION_COOKIE_NAME)?.value ?? "";

  try {
    await logoutPublic(sessionId, tenantId);
  } catch {
    // Always clear local session cookie, even when upstream revoke fails.
  }

  const response = NextResponse.redirect(new URL("/login", request.url));

  clearSessionCookie(response);
  revalidateTag(getPublicSessionCacheTag(PUBLIC_SESSION_COOKIE_NAME), {
    expire: 0,
  });

  return response;
};

// Mirrors POST for direct navigation / form GET fallbacks.
// oxlint-disable-next-line react-doctor/nextjs-no-side-effect-in-get-handler
export const GET = POST;
