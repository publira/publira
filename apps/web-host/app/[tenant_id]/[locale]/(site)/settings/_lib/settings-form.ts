import { toFormDataInput } from "@publira/utils/form-data";
import type { Locale } from "@publira/utils/i18n";
import { z } from "zod";

import { passwordFormSchema, tenantIdFormSchema } from "#lib/auth-input";
import { localeFormSchema } from "#lib/locale-form";
import { withLocalePrefix } from "#lib/locale-path";

/**
 * Where a settings Action sends the reader back to, with its flash message.
 *
 * The locale is a parameter because Actions cannot read `next/root-params`;
 * it comes from the form's hidden field.
 */
export const buildSettingsPath = (
  locale: Locale,
  status: "success" | "error",
  message: string
) => {
  const params = new URLSearchParams({ message, status });
  return `${withLocalePrefix(locale, "/settings")}?${params.toString()}`;
};

const deleteAccountFormSchema = z.object({
  locale: localeFormSchema,
  password: passwordFormSchema,
  tenantId: tenantIdFormSchema,
});

export const parseDeleteAccountForm = (formData: FormData) =>
  deleteAccountFormSchema.safeParse(
    toFormDataInput(formData, {
      locale: "value",
      password: "value",
      tenantId: "value",
    })
  );
