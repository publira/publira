import { toFormDataInput } from "@publira/utils/form-data";
import { z } from "zod";

import { passwordFormSchema, tenantIdFormSchema } from "#lib/auth-input";

export const buildSettingsPath = (
  status: "success" | "error",
  message: string
) => {
  const params = new URLSearchParams({ message, status });
  return `/settings?${params.toString()}`;
};

const deleteAccountFormSchema = z.object({
  password: passwordFormSchema,
  tenantId: tenantIdFormSchema,
});

export const parseDeleteAccountForm = (formData: FormData) =>
  deleteAccountFormSchema.safeParse(
    toFormDataInput(formData, {
      password: "value",
      tenantId: "value",
    })
  );
