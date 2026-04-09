"use server";

import type { FormActionState } from "@publira/ui-components/action-form";
import { redirect } from "next/navigation";

import { acceptTenantAdminInvitation } from "#lib/admin-auth";

const buildLoginPath = (email: string): string => {
  const params = new URLSearchParams({
    invited: "done",
    next: "/",
  });
  if (email.trim()) {
    params.set("email", email.trim());
  }
  return `/login?${params.toString()}`;
};

export const acceptInviteAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  const tenantPublicId = String(formData.get("tenant_public_id") ?? "").trim();
  const token = String(formData.get("token") ?? "").trim();
  const accountExists = String(formData.get("account_exists") ?? "") === "true";
  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "").trim();
  const confirmPassword = String(formData.get("confirm_password") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();

  if (!token) {
    return { message: "招待トークンが見つかりません。", ok: false };
  }

  if (!accountExists) {
    if (!name || !password) {
      return { message: "名前とパスワードを入力してください。", ok: false };
    }
    if (password !== confirmPassword) {
      return { message: "パスワード確認が一致しません。", ok: false };
    }
  }

  const result = await acceptTenantAdminInvitation(
    tenantPublicId,
    token,
    accountExists ? undefined : name,
    accountExists ? undefined : password
  );

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  redirect(buildLoginPath(email));
};
