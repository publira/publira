"use server";

import type { Locale } from "@publira/i18n";
import { getLocales } from "@publira/i18n";
import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { emailFormSchema, passwordFormSchema } from "#lib/auth-input";
import { assertSameOrigin } from "#lib/csrf";
import { requiredTrimmedString } from "#lib/form-schemas";
import { getInitialLocaleCandidate } from "#lib/initial-locale";
import { getMessagesFor } from "#lib/messages";
import { platformSettingsCacheTag } from "#lib/platform-settings";
import { createInitialUser } from "#lib/setup";
import { platformSetupStatusCacheTag } from "#lib/setup-status";

/**
 * The chosen locale is checked against the supported list here as well as on
 * the server: `Accept-Language` only seeded the selector, and a hand-built
 * request can name any code at all.
 *
 * The currency is checked only for its shape; the server knows which codes
 * name a currency. A form whose currency field is locked posts none, which
 * keeps the stored one, so an absent field passes and an empty choice does not.
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
      defaultCurrency: z
        .string()
        .trim()
        .regex(/^[A-Z]{3}$/u, t("platform.auth.setup.currency_required"))
        .optional(),
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
      defaultCurrency: { kind: "value", name: "default_currency" },
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

  const { defaultCurrency, defaultLocale, email, name, password } = parsed.data;
  const result = await createInitialUser({
    defaultCurrency,
    defaultLocale,
    email,
    locale,
    name,
    password,
  });
  if (!result.ok) {
    if (result.alreadyCompleted) {
      updateTag(platformSetupStatusCacheTag);
      redirect("/login");
    }
    return { message: result.message, ok: false };
  }

  updateTag(platformSetupStatusCacheTag);
  // The setup screen read the stored currency through the settings tag, and
  // the General settings screen reads the rest of what was just saved there.
  updateTag(platformSettingsCacheTag);
  redirect("/login?setup=done");
};
