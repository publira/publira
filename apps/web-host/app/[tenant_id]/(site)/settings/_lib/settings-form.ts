import { toFormDataInput } from "@publira/utils/form-data";
import { z } from "zod";

import { tenantIdFormSchema } from "#lib/auth-input";

export const buildSettingsPath = (
  status: "success" | "error",
  message: string
) => {
  const params = new URLSearchParams({ message, status });
  return `/settings?${params.toString()}`;
};

const deleteAccountFormSchema = z.object({
  password: z
    .string({ error: "退会には現在のパスワード入力が必要です。" })
    .trim()
    .min(1, "退会には現在のパスワード入力が必要です。")
    .max(1024),
  tenantId: tenantIdFormSchema,
});

export const parseDeleteAccountForm = (formData: FormData) =>
  deleteAccountFormSchema.safeParse(
    toFormDataInput(formData, {
      password: "value",
      tenantId: "value",
    })
  );
