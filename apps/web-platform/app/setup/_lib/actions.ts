"use server";

import type { FormActionState } from "@publira/ui-components/action-form";
import { redirect } from "next/navigation";

import { createInitialUser } from "#lib/setup";

export const setupAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!name || !email || !password) {
    return { message: "すべての項目を入力してください。", ok: false };
  }

  if (password !== confirmPassword) {
    return {
      message: "パスワードと確認用パスワードが一致しません。",
      ok: false,
    };
  }

  const result = await createInitialUser(name, email, password);
  if (!result.ok) {
    if (result.message.includes("既に完了")) {
      redirect("/login");
    }
    return { message: result.message, ok: false };
  }

  redirect("/login?setup=done");
};
