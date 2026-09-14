"use server";

import type { Locale } from "@publira/i18n";
import { getLocales } from "@publira/i18n";
import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { emailFormSchema, passwordFormSchema } from "#lib/auth-input";
import { assertSameOrigin } from "#lib/csrf";
import { requiredTrimmedString } from "#lib/form-schemas";
import { getInitialLocaleCandidate } from "#lib/initial-locale";
import { getMessagesFor } from "#lib/messages";
import { createInitialUser } from "#lib/setup";

/**
 * The chosen locale is checked against the supported list here as well as on
 * the server: `Accept-Language` only seeded the selector, and a hand-built
 * request can name any code at all.
 */
const setupFormSchema = async (locale: Locale) => {
  const [t, confirmPassword, email, password] = await Promise.all([
    getMessagesFor(locale),
    passwordFormSchema(locale),
    emailFormSchema(locale),
    passwordFormSchema(locale),
  ]);

  return z
    .object({
      confirmPassword,
      defaultLocale: z.enum(getLocales(), {
        error: t("platform.auth.setup.locale_required"),
      }),
      email,
      name: requiredTrimmedString(t("platform.auth.setup.name_required")),
      password,
    })
    .refine((value) => value.password === value.confirmPassword, {
      error: t("platform.auth.setup.password_mismatch"),
      path: ["confirmPassword"],
    });
};

export const setupAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  // The screen this was submitted from renders in the negotiated locale, so
  // the failure copy has to come back in the same language.
  const locale = await getInitialLocaleCandidate();

  const schema = await setupFormSchema(locale);
  const parsed = schema.safeParse(
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
