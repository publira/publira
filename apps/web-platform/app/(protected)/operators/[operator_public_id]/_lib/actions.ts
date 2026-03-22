"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getPlatformCurrentOperator } from "../../../../../lib/auth";
import {
  deactivatePlatformOperator,
  suspendPlatformOperator,
  unsuspendPlatformOperator,
  updatePlatformOperatorRole,
} from "../../../../../lib/operators";
import type { OperatorRoleFormState } from "../_components/operator-role-form";

export const updateOperatorRoleAction = async (
  _prevState: OperatorRoleFormState,
  formData: FormData
): Promise<OperatorRoleFormState> => {
  const publicId = String(formData.get("operator_public_id") ?? "").trim();
  const role = String(formData.get("operator_role") ?? "").trim();

  if (!publicId || !role) {
    return { message: "必須項目が入力されていません。", ok: false };
  }

  const me = await getPlatformCurrentOperator();
  if (me?.role !== "platform_super_admin") {
    return { message: "この操作を行う権限がありません。", ok: false };
  }
  if (me.publicId === publicId) {
    return { message: "自分自身のロールは変更できません。", ok: false };
  }

  const result = await updatePlatformOperatorRole({
    publicId,
    role,
  });
  revalidatePath(`/operators/${publicId}`);
  revalidatePath("/operators");

  if (!result.ok) {
    return { message: result.message, ok: false };
  }
  return { message: "ロールを更新しました。", ok: true };
};

export const suspendOperatorAction = async (
  publicId: string
): Promise<void> => {
  const me = await getPlatformCurrentOperator();
  if (!me || me.role !== "platform_super_admin" || me.publicId === publicId) {
    return;
  }
  await suspendPlatformOperator(publicId);
  revalidatePath(`/operators/${publicId}`);
  revalidatePath("/operators");
};

export const unsuspendOperatorAction = async (
  publicId: string
): Promise<void> => {
  const me = await getPlatformCurrentOperator();
  if (!me || me.role !== "platform_super_admin") {
    return;
  }
  await unsuspendPlatformOperator(publicId);
  revalidatePath(`/operators/${publicId}`);
  revalidatePath("/operators");
};

export const deactivateOperatorAction = async (
  publicId: string
): Promise<void> => {
  const me = await getPlatformCurrentOperator();
  if (!me || me.role !== "platform_super_admin" || me.publicId === publicId) {
    return;
  }
  await deactivatePlatformOperator(publicId);
  revalidatePath("/operators");
  redirect("/operators");
};
