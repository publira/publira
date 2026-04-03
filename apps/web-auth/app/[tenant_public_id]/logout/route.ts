import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  PUBLIC_SESSION_COOKIE_NAME,
  logoutPublic,
  sessionCookieOptions,
} from "#lib/auth";

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
  { params }: { params: Promise<{ tenant_public_id: string }> }
) => {
  const { tenant_public_id } = await params;

  const sessionId =
    request.cookies.get(PUBLIC_SESSION_COOKIE_NAME)?.value ?? "";

  try {
    await logoutPublic(sessionId, tenant_public_id);
  } catch {
    // Always clear local session cookie, even when upstream revoke fails.
  }

  const response = NextResponse.redirect(new URL("/login", request.url));

  clearSessionCookie(response);

  return response;
};

export const GET = POST;
