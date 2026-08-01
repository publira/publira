"use server";

import type { FormActionState } from "@publira/ui-components/action-form";
import { encryptSessionPayload, resolveAuthSecret } from "@publira/web-session";
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

  const sealed = await encryptSessionPayload(
    {
      accessToken: result.accessToken,
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
