"use server";

import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requestPublicPasswordReset } from "#lib/auth";
import { emailFormSchema, tenantIdFormSchema } from "#lib/auth-input";

const requestPasswordResetFormSchema = z.object({
  email: emailFormSchema,
  tenantId: tenantIdFormSchema,
});

export const requestPasswordResetAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  const parsed = requestPasswordResetFormSchema.safeParse(
    toFormDataInput(formData, {
      email: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error),
      ok: false,
    };
  }

  const { email, tenantId } = parsed.data;
  const requested = await requestPublicPasswordReset(email, tenantId);
  if (!requested) {
    return {
      message: "再設定メールの送信に失敗しました。入力内容をご確認ください。",
      ok: false,
    };
  }

  const params = new URLSearchParams({ email });
  redirect(`/reset-password/requested?${params.toString()}`);
};
