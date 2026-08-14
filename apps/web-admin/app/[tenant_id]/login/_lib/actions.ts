"use server";

import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { encryptSessionPayload, resolveAuthSecret } from "@publira/web-session";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  ADMIN_SESSION_COOKIE_NAME,
  loginAdmin,
  sessionCookieOptions,
} from "#lib/admin-auth";
import {
  emailFormSchema,
  nextPathFormSchema,
  passwordFormSchema,
  tenantIdFormSchema,
} from "#lib/auth-input";

const TENANT_MISSING_MESSAGE = "テナント識別子が見つかりませんでした。";

const loginFormSchema = z.object({
  email: emailFormSchema,
  next: nextPathFormSchema,
  password: passwordFormSchema,
  tenantId: tenantIdFormSchema,
});

const buildLoginErrorPath = (message: string, nextPath: string): string => {
  const params = new URLSearchParams({
    error: message,
    next: nextPath,
  });
  return `/login?${params.toString()}`;
};

export const loginAction = async (formData: FormData): Promise<void> => {
  const input = toFormDataInput(formData, {
    email: "value",
    next: "value",
    password: "value",
    tenantId: { kind: "value", name: "tenant_id" },
  });
  const parsed = loginFormSchema.safeParse(input);
  if (!parsed.success) {
    const nextPath = nextPathFormSchema.parse(input.next);
    const tenantIdResult = tenantIdFormSchema.safeParse(input.tenantId);
    redirect(
      buildLoginErrorPath(
        tenantIdResult.success
          ? toFormErrorMessage(parsed.error)
          : TENANT_MISSING_MESSAGE,
        nextPath
      )
    );
  }

  const { email, next: nextPath, password, tenantId } = parsed.data;

  const result = await loginAdmin(email, password, tenantId);
  if (!result.ok) {
    redirect(buildLoginErrorPath(result.message, nextPath));
  }

  try {
    const sealed = await encryptSessionPayload(
      {
        accessToken: result.accessToken,
        expiresAt: result.expiresAt.toISOString(),
        tenantId,
      },
      resolveAuthSecret()
    );
    const cookieStore = await cookies();
    cookieStore.set({
      ...sessionCookieOptions,
      expires: result.expiresAt,
      name: ADMIN_SESSION_COOKIE_NAME,
      value: sealed,
    });
  } catch (error) {
    // Not an RPC failure — sealing or writing the cookie broke, and the reason
    // is only visible in the log. Recorded, then reported as a login failure.
    console.error("[web-admin] login cookie seal failed", error);
    redirect(
      buildLoginErrorPath(
        "ログイン処理に失敗しました。時間をおいて再試行してください。",
        nextPath
      )
    );
  }

  redirect(nextPath);
};
