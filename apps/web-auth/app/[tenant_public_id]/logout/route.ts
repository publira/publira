import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  PUBLIC_SESSION_COOKIE_NAME,
  logoutPublic,
  sessionCookieOptions,
} from "../../../lib/auth";

const clearSessionCookie = async () => {
  const cookieStore = await cookies();
  cookieStore.set({
    ...sessionCookieOptions,
    expires: new Date(0),
    name: PUBLIC_SESSION_COOKIE_NAME,
    value: "",
  });
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_public_id");

export const POST = async (
  request: Request,
  { params }: { params: Promise<{ tenant_public_id: string }> }
) => {
  const { tenant_public_id } = await params;
  guardPlaceholder(tenant_public_id);

  const cookieStore = await cookies();
  const sessionId = cookieStore.get(PUBLIC_SESSION_COOKIE_NAME)?.value ?? "";

  try {
    await logoutPublic(sessionId, tenant_public_id);
  } catch {
    // Always clear local session cookie, even when upstream revoke fails.
  }

  await clearSessionCookie();
  redirect("/login");
};

export const GET = async (
  request: Request,
  { params }: { params: Promise<{ tenant_public_id: string }> }
) => {
  const { tenant_public_id } = await params;
  guardPlaceholder(tenant_public_id);

  await clearSessionCookie();
  redirect("/login");
};
