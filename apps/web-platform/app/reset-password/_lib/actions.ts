"use server";

import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { emailFormSchema } from "#lib/auth-input";
import { requestPlatformPasswordReset } from "#lib/password-reset";

const requestPasswordResetFormSchema = z.object({
  email: emailFormSchema,
});

export const requestPasswordResetAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  const parsed = requestPasswordResetFormSchema.safeParse(
    toFormDataInput(formData, {
      email: "value",
    })
  );
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error),
      ok: false,
    };
  }

  const { email } = parsed.data;
  const result = await requestPlatformPasswordReset(email);
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  const params = new URLSearchParams({ email });
  redirect(`/reset-password/requested?${params.toString()}`);
};
