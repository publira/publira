import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  PLATFORM_SESSION_COOKIE_NAME,
  loginPlatform,
  sanitizeRedirectPath,
  sessionCookieOptions,
} from "#lib/auth";

const buildLoginErrorPath = (message: string, nextPath: string): string => {
  const params = new URLSearchParams({
    error: message,
    next: sanitizeRedirectPath(nextPath),
  });
  return `/login?${params.toString()}`;
};

export const loginAction = async (formData: FormData): Promise<void> => {
  "use server";

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const nextPath = sanitizeRedirectPath(String(formData.get("next") ?? "/"));

  const result = await loginPlatform(email, password);
  if (!result) {
    redirect(
      buildLoginErrorPath(
        "メールアドレスまたはパスワードが正しくありません。",
        nextPath
      )
    );
  }

  const cookieStore = await cookies();
  cookieStore.set({
    ...sessionCookieOptions,
    expires: result.expiresAt,
    name: PLATFORM_SESSION_COOKIE_NAME,
    value: result.sessionId,
  });

  redirect(nextPath);
};
