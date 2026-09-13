import type { Locale } from "@publira/i18n";
import { toFormDataInput } from "@publira/utils/form-data";
import { z } from "zod";

import { passwordFormSchema, tenantIdFormSchema } from "#lib/auth-input";
import { localeFormSchema } from "#lib/locale-form";
import type { HostMessageAccessor } from "#lib/messages";
import { tenantLocalePath } from "#lib/tenant-locale-path";

/**
 * Where a settings Action sends the reader back to, with its flash message.
 *
 * The locale is a parameter because Actions cannot read `next/root-params`;
 * it comes from the form's hidden field.
 */
export const buildSettingsPath = async (
  locale: Locale,
  tenantId: string,
  status: "success" | "error",
  message: string
): Promise<string> => {
  const params = new URLSearchParams({ message, status });
  const path = await tenantLocalePath(tenantId, locale, "/settings");
  return `${path}?${params.toString()}`;
};

const deleteAccountFormSchema = (t: HostMessageAccessor) =>
  z.object({
    locale: localeFormSchema,
    password: passwordFormSchema(t),
    tenantId: tenantIdFormSchema(t),
  });

export const parseDeleteAccountForm = (
  t: HostMessageAccessor,
  formData: FormData
) =>
  deleteAccountFormSchema(t).safeParse(
    toFormDataInput(formData, {
      locale: "value",
      password: "value",
      tenantId: "value",
    })
  );
