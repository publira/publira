"use server";

import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { PlatformCurrentOperator } from "#lib/auth";
import { getPlatformCurrentOperator } from "#lib/auth";
import {
  redirectToLoginIfSessionRejected,
  withPlatformSessionReauth,
} from "#lib/auth-session";
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

/**
 * The operator submitting this Action, once a rejected session has been sent to
 * login.
 *
 * A Server Action is its own request, so it authenticates independently of the
 * page that rendered the control. A rejected session used to arrive as the same
 * `null` a `GetMe` without an operator does, and「この操作を行う権限がありません。」
 * next to a button is a dead end for someone who has simply been signed out.
 */
const resolveCurrentOperator =
  async (): Promise<PlatformCurrentOperator | null> => {
    const result = await getPlatformCurrentOperator();
    await redirectToLoginIfSessionRejected(result);
    return result.ok ? result.operator : null;
  };

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

  const me = await resolveCurrentOperator();
  if (!(me && isPlatformSuperAdmin(me.role))) {
    return { message: "この操作を行う権限がありません。", ok: false };
  }
  if (me.publicId === publicId) {
    return { message: "自分自身のロールは変更できません。", ok: false };
  }

  const result = await withPlatformSessionReauth(() =>
    updatePlatformOperatorRole({
      publicId,
      role,
    })
  );
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

  const me = await resolveCurrentOperator();
  if (!(me && isPlatformSuperAdmin(me.role)) || me.publicId === parsed.data) {
    return;
  }
  await withPlatformSessionReauth(() => suspendPlatformOperator(parsed.data));
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

  const me = await resolveCurrentOperator();
  if (!(me && isPlatformSuperAdmin(me.role))) {
    return;
  }
  await withPlatformSessionReauth(() => unsuspendPlatformOperator(parsed.data));
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

  const me = await resolveCurrentOperator();
  if (!(me && isPlatformSuperAdmin(me.role)) || me.publicId === parsed.data) {
    return;
  }
  await withPlatformSessionReauth(() =>
    deactivatePlatformOperator(parsed.data)
  );
  revalidatePath("/operators");
  redirect("/operators");
};
