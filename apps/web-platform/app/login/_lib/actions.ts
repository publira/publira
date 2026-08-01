"use server";

import type { FormActionState } from "@publira/ui-components/action-form";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  PLATFORM_SESSION_COOKIE_NAME,
  loginPlatform,
  sanitizeRedirectPath,
  sessionCookieOptions,
} from "#lib/auth";

export const loginAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const nextPath = sanitizeRedirectPath(String(formData.get("next") ?? "/"));

  const result = await loginPlatform(email, password);
  if (!result) {
    return {
      message: "メールアドレスまたはパスワードが正しくありません。",
      ok: false,
    };
  }

  const { encryptSessionPayload, resolveAuthSecret } = await import(
    "@publira/web-session"
  );
  const sealed = await encryptSessionPayload(
    {
      accessToken: result.sessionId,
      expiresAt: result.expiresAt.toISOString(),
    },
    resolveAuthSecret()
  );
  const cookieStore = await cookies();
  cookieStore.set({
    ...sessionCookieOptions,
    expires: result.expiresAt,
    name: PLATFORM_SESSION_COOKIE_NAME,
    value: sealed,
  });

  redirect(nextPath);
};
