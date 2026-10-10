"use server";

import type { Locale } from "@publira/i18n";
import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { loginPlatform } from "#lib/auth";
import {
  emailFormSchema,
  nextPathFormSchema,
  passwordFormSchema,
} from "#lib/auth-input";
import { assertSameOrigin } from "#lib/csrf";
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { MFA_PATH, writeMfaChallenge } from "#lib/mfa-challenge";
import { writePlatformSessionCookie } from "#lib/platform-session-cookie";

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
    // so it says nothing about whether the password was right, and neither
    // does a response the console could not hold.
    switch (result.refusal) {
      case "rate-limited": {
        return { message: t("errors.rpc.rate-limited"), ok: false };
      }
      case "processing": {
        return {
          message: t("platform.auth.login.processing_failed"),
          ok: false,
        };
      }
      default: {
        return { message: t("platform.auth.login.failed"), ok: false };
      }
    }
  }

  if (result.kind === "challenge") {
    await writeMfaChallenge({
      challengeToken: result.challengeToken,
      expiresAt: result.expiresAt.toString(),
      kind: result.challengeKind,
      nextPath,
    });
    redirect(MFA_PATH);
  }

  await writePlatformSessionCookie(result.session);
  redirect(nextPath);
};
