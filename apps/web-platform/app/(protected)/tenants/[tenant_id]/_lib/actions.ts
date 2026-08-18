"use server";

import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { emailFormSchema } from "#lib/auth-input";
import { withPlatformSessionReauth } from "#lib/auth-session";
import {
  optionalTrimmedString,
  requiredTrimmedString,
} from "#lib/form-schemas";
import {
  addPlatformTenantMember,
  cancelPlatformTenantAdminInvitation,
  createPlatformTenantAdminInvitation,
  removePlatformTenantMember,
  resendPlatformTenantAdminInvitation,
  resumePlatformTenant,
  suspendPlatformTenant,
  updatePlatformTenant,
  updatePlatformTenantMemberRole,
} from "#lib/tenants";

const tenantIdFormSchema = requiredTrimmedString(
  "必須項目が入力されていません。"
);

const tenantMemberRoleFormSchema = z.enum(
  ["tenant_admin", "tenant_auditor", "tenant_editor"],
  { error: "必須項目が入力されていません。" }
);

const tenantIdOnlySchema = z.object({
  tenantId: tenantIdFormSchema,
});

const updateTenantNameFormSchema = z.object({
  currentDomain: optionalTrimmedString(),
  name: requiredTrimmedString("必須項目が入力されていません。"),
  tenantId: tenantIdFormSchema,
});

const updateTenantDomainFormSchema = z.object({
  adminDomain: optionalTrimmedString(),
  currentName: requiredTrimmedString("必須項目が入力されていません。"),
  domain: requiredTrimmedString("ドメインは必須です。"),
  tenantId: tenantIdFormSchema,
});

const addTenantMemberFormSchema = z.object({
  email: emailFormSchema,
  role: tenantMemberRoleFormSchema,
  tenantId: tenantIdFormSchema,
});

const updateTenantMemberRoleFormSchema = z.object({
  role: tenantMemberRoleFormSchema,
  tenantId: tenantIdFormSchema,
  userPublicId: requiredTrimmedString("必須項目が入力されていません。"),
});

const removeTenantMemberFormSchema = z.object({
  tenantId: tenantIdFormSchema,
  userPublicId: requiredTrimmedString("必須項目が入力されていません。"),
});

const createInvitationFormSchema = z.object({
  email: emailFormSchema,
  tenantId: tenantIdFormSchema,
});

const invitationIdFormSchema = z.object({
  invitationId: requiredTrimmedString("必須項目が入力されていません。"),
  tenantId: tenantIdFormSchema,
});

const revalidateTenantMemberPaths = (tenantId: string) => {
  revalidatePath(`/tenants/${tenantId}`);
  revalidatePath(`/tenants/${tenantId}/members`);
};

export const suspendTenantAction = async (
  formData: FormData
): Promise<void> => {
  const parsed = tenantIdOnlySchema.safeParse(
    toFormDataInput(formData, {
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );
  if (!parsed.success) {
    return;
  }

  await withPlatformSessionReauth(() =>
    suspendPlatformTenant(parsed.data.tenantId)
  );
  revalidatePath(`/tenants/${parsed.data.tenantId}`);
  revalidatePath("/tenants");
};

export const resumeTenantAction = async (formData: FormData): Promise<void> => {
  const parsed = tenantIdOnlySchema.safeParse(
    toFormDataInput(formData, {
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );
  if (!parsed.success) {
    return;
  }

  await withPlatformSessionReauth(() =>
    resumePlatformTenant(parsed.data.tenantId)
  );
  revalidatePath(`/tenants/${parsed.data.tenantId}`);
  revalidatePath("/tenants");
};

export const updateTenantNameAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  const parsed = updateTenantNameFormSchema.safeParse(
    toFormDataInput(formData, {
      currentDomain: { kind: "value", name: "tenant_current_domain" },
      name: { kind: "value", name: "tenant_name" },
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error), ok: false };
  }

  const result = await withPlatformSessionReauth(() =>
    updatePlatformTenant(
      parsed.data.tenantId,
      parsed.data.name,
      parsed.data.currentDomain
    )
  );
  revalidatePath(`/tenants/${parsed.data.tenantId}`);
  if (!result.ok) {
    return { message: result.message, ok: false };
  }
  return { message: "保存しました。", ok: true };
};

export const updateTenantDomainAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  const parsed = updateTenantDomainFormSchema.safeParse(
    toFormDataInput(formData, {
      adminDomain: { kind: "value", name: "tenant_admin_domain" },
      currentName: { kind: "value", name: "tenant_current_name" },
      domain: { kind: "value", name: "tenant_domain" },
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error), ok: false };
  }

  const result = await withPlatformSessionReauth(() =>
    updatePlatformTenant(
      parsed.data.tenantId,
      parsed.data.currentName,
      parsed.data.domain,
      parsed.data.adminDomain
    )
  );
  revalidatePath(`/tenants/${parsed.data.tenantId}`);
  if (!result.ok) {
    return { message: result.message, ok: false };
  }
  return { message: "保存しました。", ok: true };
};

export const addTenantMemberAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  const parsed = addTenantMemberFormSchema.safeParse(
    toFormDataInput(formData, {
      email: { kind: "value", name: "member_email" },
      role: { kind: "value", name: "member_role" },
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error), ok: false };
  }

  const result = await withPlatformSessionReauth(() =>
    addPlatformTenantMember(parsed.data)
  );

  revalidateTenantMemberPaths(parsed.data.tenantId);

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  return { message: "メンバーを追加しました。", ok: true };
};

export const updateTenantMemberRoleAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  const parsed = updateTenantMemberRoleFormSchema.safeParse(
    toFormDataInput(formData, {
      role: { kind: "value", name: "member_role" },
      tenantId: { kind: "value", name: "tenant_id" },
      userPublicId: { kind: "value", name: "member_user_public_id" },
    })
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error), ok: false };
  }

  const result = await withPlatformSessionReauth(() =>
    updatePlatformTenantMemberRole(
      parsed.data.tenantId,
      parsed.data.userPublicId,
      parsed.data.role
    )
  );

  revalidateTenantMemberPaths(parsed.data.tenantId);

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  return { message: "ロールを更新しました。", ok: true };
};

export const removeTenantMemberAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  const parsed = removeTenantMemberFormSchema.safeParse(
    toFormDataInput(formData, {
      tenantId: { kind: "value", name: "tenant_id" },
      userPublicId: { kind: "value", name: "member_user_public_id" },
    })
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error), ok: false };
  }

  const result = await withPlatformSessionReauth(() =>
    removePlatformTenantMember(parsed.data.tenantId, parsed.data.userPublicId)
  );

  revalidateTenantMemberPaths(parsed.data.tenantId);

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  return { message: "メンバーを削除しました。", ok: true };
};

export const createTenantAdminInvitationAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  const parsed = createInvitationFormSchema.safeParse(
    toFormDataInput(formData, {
      email: { kind: "value", name: "invite_email" },
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error), ok: false };
  }

  const result = await withPlatformSessionReauth(() =>
    createPlatformTenantAdminInvitation(parsed.data.tenantId, parsed.data.email)
  );

  revalidateTenantMemberPaths(parsed.data.tenantId);

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  if (result.roleGrantedImmediately) {
    return {
      message: "既存ユーザーをテナント管理者として追加しました。",
      ok: true,
    };
  }

  return { message: "招待メールを送信しました。", ok: true };
};

export const resendTenantAdminInvitationAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  const parsed = invitationIdFormSchema.safeParse(
    toFormDataInput(formData, {
      invitationId: { kind: "value", name: "invitation_id" },
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error), ok: false };
  }

  const result = await withPlatformSessionReauth(() =>
    resendPlatformTenantAdminInvitation(
      parsed.data.tenantId,
      parsed.data.invitationId
    )
  );

  revalidateTenantMemberPaths(parsed.data.tenantId);

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  return { message: "招待メールを再送しました。", ok: true };
};

export const cancelTenantAdminInvitationAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  const parsed = invitationIdFormSchema.safeParse(
    toFormDataInput(formData, {
      invitationId: { kind: "value", name: "invitation_id" },
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error), ok: false };
  }

  const result = await withPlatformSessionReauth(() =>
    cancelPlatformTenantAdminInvitation(
      parsed.data.tenantId,
      parsed.data.invitationId
    )
  );

  revalidateTenantMemberPaths(parsed.data.tenantId);

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  return { message: "招待を取り消しました。", ok: true };
};
