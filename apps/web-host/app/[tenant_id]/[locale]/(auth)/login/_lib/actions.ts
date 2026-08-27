"use server";

import { parseLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { toFormDataInput } from "@publira/utils/form-data";
import { sessionCookieOptions } from "@publira/web-session";
import { updateTag } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { sealSessionCookieValue } from "#lib/api-client";
import { PUBLIC_SESSION_COOKIE_NAME, loginPublic } from "#lib/auth";
import {
  emailFormSchema,
  passwordFormSchema,
  returnToFormSchema,
  tenantIdFormSchema,
} from "#lib/auth-input";
import { getPublicSessionCacheTag } from "#lib/auth-shared";
import { assertSameOrigin } from "#lib/csrf";
import { localeFormSchema } from "#lib/locale-form";
import { withLocalePrefix } from "#lib/locale-path";

const LOGIN_FAILED_MESSAGE =
  "メールアドレスまたはパスワードが正しくありません。";

const loginFormSchema = z.object({
  email: emailFormSchema,
  locale: localeFormSchema,
  password: passwordFormSchema,
  returnTo: returnToFormSchema,
  tenantId: tenantIdFormSchema,
});

const buildLoginErrorPath = (
  locale: Locale,
  message: string,
  returnToPath: string
): string => {
  const params = new URLSearchParams({
    error: message,
    returnTo: returnToPath,
  });
  return `${withLocalePrefix(locale, "/login")}?${params.toString()}`;
};

export const loginAction = async (formData: FormData): Promise<void> => {
  await assertSameOrigin();
  const parsed = loginFormSchema.safeParse(
    toFormDataInput(formData, {
      email: "value",
      locale: "value",
      password: "value",
      returnTo: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    const returnToPath = returnToFormSchema.parse(
      toFormDataInput(formData, { returnTo: "value" }).returnTo
    );
    redirect(
      buildLoginErrorPath(
        parseLocale(formData.get("locale")),
        LOGIN_FAILED_MESSAGE,
        returnToPath
      )
    );
  }

  const {
    email,
    locale,
    password,
    returnTo: returnToPath,
    tenantId,
  } = parsed.data;

  const result = await loginPublic(email, password, tenantId);
  if (!result) {
    redirect(buildLoginErrorPath(locale, LOGIN_FAILED_MESSAGE, returnToPath));
  }

  const sealed = await sealSessionCookieValue({
    accessToken: result.accessToken,
    expiresAt: result.expiresAt.toISOString(),
    tenantId,
  });
  const cookieStore = await cookies();
  cookieStore.set({
    ...sessionCookieOptions(result.expiresAt),
    name: PUBLIC_SESSION_COOKIE_NAME,
    value: sealed,
  });
  updateTag(getPublicSessionCacheTag(PUBLIC_SESSION_COOKIE_NAME));

  // `returnTo` is stored locale-less, so the reader comes back in whichever
  // language they signed in from rather than the one they left.
  redirect(withLocalePrefix(locale, returnToPath));
};
