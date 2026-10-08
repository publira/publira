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
import { updateTag } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { PLATFORM_SESSION_COOKIE_NAME, loginPlatform } from "#lib/auth";
import {
  emailFormSchema,
  nextPathFormSchema,
  passwordFormSchema,
} from "#lib/auth-input";
import { PLATFORM_SESSION_CACHE_TAG } from "#lib/auth-shared";
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
  if (!result.ok) {
    // A refusal for too many attempts came before the password was checked,
    // so it says nothing about whether the password was right.
    return {
      message:
        result.refusal === "rate-limited"
          ? t("errors.rpc.rate-limited")
          : t("platform.auth.login.failed"),
      ok: false,
    };
  }

  const { session } = result;
  const sealed = await encryptSessionPayload(
    {
      accessToken: session.accessToken,
      expiresAt: session.expiresAt.toISOString(),
    },
    resolveAuthSecret()
  );
  const cookieStore = await cookies();
  cookieStore.set({
    ...sessionCookieOptions(session.expiresAt),
    name: PLATFORM_SESSION_COOKIE_NAME,
    value: sealed,
  });
  updateTag(PLATFORM_SESSION_CACHE_TAG);

  redirect(nextPath);
};
