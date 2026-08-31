"use server";

import { getLocales, getMessage } from "@publira/i18n";
import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { emailFormSchema, passwordFormSchema } from "#lib/auth-input";
import { assertSameOrigin } from "#lib/csrf";
import { requiredTrimmedString } from "#lib/form-schemas";
import { getInitialLocaleCandidate } from "#lib/initial-locale";
import { loadPlatformMessages } from "#lib/locale";
import type { PlatformMessages } from "#lib/locale";
import { createInitialUser } from "#lib/setup";

/**
 * The chosen locale is checked against the supported list here as well as on
 * the server: `Accept-Language` only seeded the selector, and a hand-built
 * request can name any code at all.
 */
const setupFormSchema = (messages: PlatformMessages) =>
  z
    .object({
      confirmPassword: passwordFormSchema(messages),
      defaultLocale: z.enum(getLocales(), {
        error: getMessage(messages, "platform.auth.setup.locale_required"),
      }),
      email: emailFormSchema(messages),
      name: requiredTrimmedString(
        getMessage(messages, "platform.auth.setup.name_required")
      ),
      password: passwordFormSchema(messages),
    })
    .refine((value) => value.password === value.confirmPassword, {
      error: getMessage(messages, "platform.auth.setup.password_mismatch"),
      path: ["confirmPassword"],
    });

export const setupAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  // The screen this was submitted from renders in the negotiated locale, so
  // the failure copy has to come back in the same language.
  const locale = await getInitialLocaleCandidate();
  const messages = await loadPlatformMessages(locale);

  const parsed = setupFormSchema(messages).safeParse(
    toFormDataInput(formData, {
      confirmPassword: "value",
      defaultLocale: { kind: "value", name: "default_locale" },
      email: "value",
      name: "value",
      password: "value",
    })
  );
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, { locale }),
      ok: false,
    };
  }

  const { defaultLocale, email, name, password } = parsed.data;
  const result = await createInitialUser({
    defaultLocale,
    email,
    locale,
    name,
    password,
  });
  if (!result.ok) {
    if (result.alreadyCompleted) {
      redirect("/login");
    }
    return { message: result.message, ok: false };
  }

  redirect("/login?setup=done");
};
