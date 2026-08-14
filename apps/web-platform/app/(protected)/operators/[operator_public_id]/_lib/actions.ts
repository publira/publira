"use server";

import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getPlatformCurrentOperator } from "#lib/auth";
import { requiredTrimmedString } from "#lib/form-schemas";
import {
  deactivatePlatformOperator,
  suspendPlatformOperator,
  unsuspendPlatformOperator,
  updatePlatformOperatorRole,
} from "#lib/operators";
import { isPlatformSuperAdmin } from "#lib/roles";

const operatorPublicIdSchema = requiredTrimmedString(
  "必須項目が入力されていません。"
);

const updateOperatorRoleFormSchema = z.object({
  publicId: operatorPublicIdSchema,
  role: z.enum(
    ["platform_auditor", "platform_operator", "platform_super_admin"],
    { error: "必須項目が入力されていません。" }
  ),
});

export const updateOperatorRoleAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  const parsed = updateOperatorRoleFormSchema.safeParse(
    toFormDataInput(formData, {
      publicId: { kind: "value", name: "operator_public_id" },
      role: { kind: "value", name: "operator_role" },
    })
  );
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error),
      ok: false,
    };
  }

  const { publicId, role } = parsed.data;

  const me = await getPlatformCurrentOperator();
  if (!me || !isPlatformSuperAdmin(me.role)) {
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
  const parsed = operatorPublicIdSchema.safeParse(publicId);
  if (!parsed.success) {
    return;
  }

  const me = await getPlatformCurrentOperator();
  if (!me || !isPlatformSuperAdmin(me.role) || me.publicId === parsed.data) {
    return;
  }
  await suspendPlatformOperator(parsed.data);
  revalidatePath(`/operators/${parsed.data}`);
  revalidatePath("/operators");
};

export const unsuspendOperatorAction = async (
  publicId: string
): Promise<void> => {
  const parsed = operatorPublicIdSchema.safeParse(publicId);
  if (!parsed.success) {
    return;
  }

  const me = await getPlatformCurrentOperator();
  if (!me || !isPlatformSuperAdmin(me.role)) {
    return;
  }
  await unsuspendPlatformOperator(parsed.data);
  revalidatePath(`/operators/${parsed.data}`);
  revalidatePath("/operators");
};

export const deactivateOperatorAction = async (
  publicId: string
): Promise<void> => {
  const parsed = operatorPublicIdSchema.safeParse(publicId);
  if (!parsed.success) {
    return;
  }

  const me = await getPlatformCurrentOperator();
  if (!me || !isPlatformSuperAdmin(me.role) || me.publicId === parsed.data) {
    return;
  }
  await deactivatePlatformOperator(parsed.data);
  revalidatePath("/operators");
  redirect("/operators");
};
