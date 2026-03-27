import { redirect } from "next/navigation";

import { createInitialUser } from "../../../lib/setup";

export const setupAction = async (formData: FormData): Promise<void> => {
  "use server";

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!name || !email || !password) {
    redirect(
      `/setup?error=${encodeURIComponent("すべての項目を入力してください。")}`
    );
  }

  if (password !== confirmPassword) {
    redirect(
      `/setup?error=${encodeURIComponent("パスワードと確認用パスワードが一致しません。")}`
    );
  }

  const result = await createInitialUser(name, email, password);
  if (!result.ok) {
    if (result.message.includes("既に完了")) {
      redirect("/login");
    }
    redirect(`/setup?error=${encodeURIComponent(result.message)}`);
  }

  redirect("/login?setup=done");
};
