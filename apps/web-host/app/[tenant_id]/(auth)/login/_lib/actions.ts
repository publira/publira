"use server";

import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { sealSessionCookieValue } from "#lib/api-client";
import {
  PUBLIC_SESSION_COOKIE_NAME,
  loginPublic,
  sessionCookieOptions,
} from "#lib/auth";
import {
  emailFormSchema,
  passwordFormSchema,
  returnToFormSchema,
  tenantIdFormSchema,
} from "#lib/auth-input";
import { getPublicSessionCacheTag } from "#lib/auth-shared";

const LOGIN_FAILED_MESSAGE =
  "メールアドレスまたはパスワードが正しくありません。";

const loginFormSchema = z.object({
  email: emailFormSchema,
  password: passwordFormSchema,
  returnTo: returnToFormSchema,
  tenantId: tenantIdFormSchema,
});

const buildLoginErrorPath = (message: string, returnToPath: string): string => {
  const params = new URLSearchParams({
    error: message,
    returnTo: returnToPath,
  });
  return `/login?${params.toString()}`;
};

export const loginAction = async (formData: FormData): Promise<void> => {
  const parsed = loginFormSchema.safeParse(
    toFormDataInput(formData, {
      email: "value",
      password: "value",
      returnTo: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    const returnToPath = returnToFormSchema.parse(
      toFormDataInput(formData, { returnTo: "value" }).returnTo
    );
    redirect(buildLoginErrorPath(LOGIN_FAILED_MESSAGE, returnToPath));
  }

  const { email, password, returnTo: returnToPath, tenantId } = parsed.data;

  const result = await loginPublic(email, password, tenantId);
  if (!result) {
    redirect(buildLoginErrorPath(LOGIN_FAILED_MESSAGE, returnToPath));
  }

  const sealed = await sealSessionCookieValue({
    accessToken: result.accessToken,
    expiresAt: result.expiresAt.toISOString(),
    tenantId,
  });
  const cookieStore = await cookies();
  cookieStore.set({
    ...sessionCookieOptions,
    expires: result.expiresAt,
    name: PUBLIC_SESSION_COOKIE_NAME,
    value: sealed,
  });
  updateTag(getPublicSessionCacheTag(PUBLIC_SESSION_COOKIE_NAME));

  redirect(returnToPath);
};
