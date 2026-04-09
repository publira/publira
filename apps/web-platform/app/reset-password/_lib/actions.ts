"use server";

import type { FormActionState } from "@publira/utils/form-action";
import { redirect } from "next/navigation";

import { requestPlatformPasswordReset } from "#lib/password-reset";

export const requestPasswordResetAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  const email = String(formData.get("email") ?? "").trim();

  if (!email) {
    return { message: "メールアドレスを入力してください。", ok: false };
  }

  const result = await requestPlatformPasswordReset(email);
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  const params = new URLSearchParams({ email });
  redirect(`/reset-password/requested?${params.toString()}`);
};
