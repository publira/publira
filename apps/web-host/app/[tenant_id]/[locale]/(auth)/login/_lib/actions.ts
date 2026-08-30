"use server";

import { getMessage, parseLocale } from "@publira/i18n";
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
import { loadHostMessages } from "#lib/messages";
import type { HostMessages } from "#lib/messages";
import { tenantLocalePath } from "#lib/tenant-locale-path";

const loginFormSchema = (messages: HostMessages) =>
  z.object({
    email: emailFormSchema(messages),
    locale: localeFormSchema,
    password: passwordFormSchema(messages),
    returnTo: returnToFormSchema,
    tenantId: tenantIdFormSchema(messages),
  });

const buildLoginErrorPath = async (
  locale: Locale,
  tenantId: string,
  message: string,
  returnToPath: string
): Promise<string> => {
  const params = new URLSearchParams({
    error: message,
    returnTo: returnToPath,
  });
  const path = await tenantLocalePath(tenantId, locale, "/login");
  return `${path}?${params.toString()}`;
};

export const loginAction = async (formData: FormData): Promise<void> => {
  await assertSameOrigin();
  // The locale field falls back rather than failing, so the rejection below can
  // be worded in the reader's language even when the rest of the form is not.
  const submittedLocale = parseLocale(formData.get("locale"));
  const messages = await loadHostMessages(submittedLocale);
  const loginFailed = getMessage(messages, "host.auth.errors.login_failed");
  const parsed = loginFormSchema(messages).safeParse(
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
    const errorPath = await buildLoginErrorPath(
      submittedLocale,
      String(formData.get("tenantId") ?? ""),
      loginFailed,
      returnToPath
    );
    redirect(errorPath);
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
    const errorPath = await buildLoginErrorPath(
      locale,
      tenantId,
      loginFailed,
      returnToPath
    );
    redirect(errorPath);
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
  const destination = await tenantLocalePath(tenantId, locale, returnToPath);
  redirect(destination);
};
