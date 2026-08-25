"use server";

import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { getMessage } from "@publira/utils/i18n";
import { encryptSessionPayload, resolveAuthSecret } from "@publira/web-session";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  PLATFORM_SESSION_COOKIE_NAME,
  loginPlatform,
  sessionCookieOptions,
} from "#lib/auth";
import {
  emailFormSchema,
  nextPathFormSchema,
  passwordFormSchema,
} from "#lib/auth-input";
import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";
import type { PlatformMessages } from "#lib/locale";

const loginFormSchema = (messages: PlatformMessages) =>
  z.object({
    email: emailFormSchema(messages),
    next: nextPathFormSchema,
    password: passwordFormSchema(messages),
  });

export const loginAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  const parsed = loginFormSchema(messages).safeParse(
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
      message: getMessage(messages, "platform.auth.login.failed"),
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
