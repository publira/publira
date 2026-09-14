"use server";

import type { Locale } from "@publira/i18n";
import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import {
  encryptSessionPayload,
  resolveAuthSecret,
  sessionCookieOptions,
} from "@publira/web-session";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { PLATFORM_SESSION_COOKIE_NAME, loginPlatform } from "#lib/auth";
import {
  emailFormSchema,
  nextPathFormSchema,
  passwordFormSchema,
} from "#lib/auth-input";
import { assertSameOrigin } from "#lib/csrf";
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";

const loginFormSchema = async (locale: Locale) =>
  z.object({
    email: await emailFormSchema(locale),
    next: nextPathFormSchema,
    password: await passwordFormSchema(locale),
  });

export const loginAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getPlatformLocale();
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    loginFormSchema(locale),
  ]);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      email: "value",
      next: "value",
      password: "value",
    })
  );
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, { locale }),
      ok: false,
    };
  }

  const { email, next: nextPath, password } = parsed.data;

  const result = await loginPlatform(email, password);
  if (!result) {
    return {
      message: t("platform.auth.login.failed"),
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
    ...sessionCookieOptions(result.expiresAt),
    name: PLATFORM_SESSION_COOKIE_NAME,
    value: sealed,
  });

  redirect(nextPath);
};
