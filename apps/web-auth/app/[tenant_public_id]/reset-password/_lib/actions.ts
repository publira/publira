"use server";

import type { FormActionState } from "@publira/utils/form-action";
import { redirect } from "next/navigation";

import { requestPublicPasswordReset } from "#lib/auth";

export const requestPasswordResetAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  const email = String(formData.get("email") ?? "").trim();
  const tenantPublicId = String(formData.get("tenantPublicId") ?? "").trim();

  if (!email) {
    return { message: "メールアドレスを入力してください。", ok: false };
  }

  const requested = await requestPublicPasswordReset(email, tenantPublicId);
  if (!requested) {
    return {
      message: "再設定メールの送信に失敗しました。入力内容をご確認ください。",
      ok: false,
    };
  }

  const params = new URLSearchParams({ email });
  redirect(`/reset-password/requested?${params.toString()}`);
};
