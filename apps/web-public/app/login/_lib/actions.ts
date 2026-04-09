"use server";

import type { FormActionState } from "@publira/utils/form-action";
import { updateTag } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  PUBLIC_SESSION_COOKIE_NAME,
  loginPublic,
  sanitizeRedirectPath,
  sessionCookieOptions,
} from "#lib/auth";
import { getPublicSessionCacheTag } from "#lib/auth-shared";

export const loginAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const returnToPath = sanitizeRedirectPath(
    String(formData.get("returnTo") ?? "/")
  );

  const result = await loginPublic(email, password);
  if (!result) {
    return {
      message: "メールアドレスまたはパスワードが正しくありません。",
      ok: false,
    };
  }

  const cookieStore = await cookies();
  cookieStore.set({
    ...sessionCookieOptions,
    expires: result.expiresAt,
    name: PUBLIC_SESSION_COOKIE_NAME,
    value: result.sessionId,
  });
  updateTag(getPublicSessionCacheTag(PUBLIC_SESSION_COOKIE_NAME));

  redirect(returnToPath);
};
