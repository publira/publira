"use server";

import type { FormActionState } from "@publira/utils/form-action";
import { redirect } from "next/navigation";

import { signupPublic } from "#lib/auth";

export const signupAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  const tenantPublicId = String(formData.get("tenantPublicId") ?? "").trim();

  if (!name || !email || !password) {
    return {
      message: "名前・メールアドレス・パスワードは必須です。",
      ok: false,
    };
  }
  if (password !== confirmPassword) {
    return { message: "パスワード確認が一致しません。", ok: false };
  }

  const result = await signupPublic(name, email, password, tenantPublicId);
  if (!result) {
    return {
      message: "新規登録に失敗しました。入力内容をご確認ください。",
      ok: false,
    };
  }

  if (result.pendingVerification) {
    const params = new URLSearchParams({ email });
    redirect(`/signup/pending?${params.toString()}`);
  }

  redirect("/my");
};
