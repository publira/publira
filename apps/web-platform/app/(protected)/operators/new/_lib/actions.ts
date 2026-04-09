"use server";

import type { FormActionState } from "@publira/utils/form-action";
import { redirect } from "next/navigation";

import { createPlatformOperator } from "#lib/operators";

export const createOperatorAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  const name = String(formData.get("operator_name") ?? "").trim();
  const email = String(formData.get("operator_email") ?? "").trim();
  const role = String(formData.get("operator_role") ?? "").trim();

  if (!name || !email || !role) {
    return { message: "名前・メール・ロールはすべて必須です。", ok: false };
  }

  const result = await createPlatformOperator({ email, name, role });

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  redirect("/operators");
};
