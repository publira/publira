"use server";

import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { emailFormSchema } from "#lib/auth-input";
import { withPlatformSessionReauth } from "#lib/auth-session";
import { requiredTrimmedString } from "#lib/form-schemas";
import { createPlatformOperator } from "#lib/operators";

const createOperatorFormSchema = z.object({
  email: emailFormSchema,
  name: requiredTrimmedString("名前・メール・ロールはすべて必須です。"),
  role: z.enum(
    ["platform_auditor", "platform_operator", "platform_super_admin"],
    { error: "名前・メール・ロールはすべて必須です。" }
  ),
});

export const createOperatorAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  const parsed = createOperatorFormSchema.safeParse(
    toFormDataInput(formData, {
      email: { kind: "value", name: "operator_email" },
      name: { kind: "value", name: "operator_name" },
      role: { kind: "value", name: "operator_role" },
    })
  );
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error),
      ok: false,
    };
  }

  const result = await withPlatformSessionReauth(() =>
    createPlatformOperator(parsed.data)
  );

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  redirect("/operators");
};
