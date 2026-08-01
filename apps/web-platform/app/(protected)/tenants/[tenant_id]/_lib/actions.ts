"use server";

import type { FormActionState } from "@publira/ui-components/action-form";
import { revalidatePath } from "next/cache";

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

export const suspendTenantAction = async (
  formData: FormData
): Promise<void> => {
  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  if (!tenantId) {
    return;
  }

  await suspendPlatformTenant(tenantId);
  revalidatePath(`/tenants/${tenantId}`);
  revalidatePath("/tenants");
};

export const resumeTenantAction = async (formData: FormData): Promise<void> => {
  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  if (!tenantId) {
    return;
  }

  await resumePlatformTenant(tenantId);
  revalidatePath(`/tenants/${tenantId}`);
  revalidatePath("/tenants");
};

export const updateTenantNameAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  const name = String(formData.get("tenant_name") ?? "").trim();
  const currentDomain = String(
    formData.get("tenant_current_domain") ?? ""
  ).trim();
  if (!tenantId || !name) {
    return { message: "必須項目が入力されていません。", ok: false };
  }

  const result = await updatePlatformTenant(
    tenantId,
    name,
    currentDomain
  );
  revalidatePath(`/tenants/${tenantId}`);
  if (!result.ok) {
    return { message: result.message, ok: false };
  }
  return { message: "保存しました。", ok: true };
};

export const updateTenantDomainAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  const currentName = String(formData.get("tenant_current_name") ?? "").trim();
  const domain = String(formData.get("tenant_domain") ?? "").trim();
  const adminDomain = String(formData.get("tenant_admin_domain") ?? "").trim();
  if (!tenantId || !currentName) {
    return { message: "必須項目が入力されていません。", ok: false };
  }
  if (!domain) {
    return { message: "ドメインは必須です。", ok: false };
  }

  const result = await updatePlatformTenant(
    tenantId,
    currentName,
    domain,
    adminDomain
  );
  revalidatePath(`/tenants/${tenantId}`);
  if (!result.ok) {
    return { message: result.message, ok: false };
  }
  return { message: "保存しました。", ok: true };
};

export const addTenantMemberAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  const email = String(formData.get("member_email") ?? "").trim();
  const role = String(formData.get("member_role") ?? "").trim();

  const result = await addPlatformTenantMember({
    email,
    role,
    tenantId,
  });

  revalidatePath(`/tenants/${tenantId}`);
  revalidatePath(`/tenants/${tenantId}/members`);

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  return { message: "メンバーを追加しました。", ok: true };
};

export const updateTenantMemberRoleAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  const userPublicId = String(
    formData.get("member_user_public_id") ?? ""
  ).trim();
  const role = String(formData.get("member_role") ?? "").trim();

  const result = await updatePlatformTenantMemberRole(
    tenantId,
    userPublicId,
    role
  );

  revalidatePath(`/tenants/${tenantId}`);
  revalidatePath(`/tenants/${tenantId}/members`);

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  return { message: "ロールを更新しました。", ok: true };
};

export const removeTenantMemberAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  const userPublicId = String(
    formData.get("member_user_public_id") ?? ""
  ).trim();

  const result = await removePlatformTenantMember(tenantId, userPublicId);

  revalidatePath(`/tenants/${tenantId}`);
  revalidatePath(`/tenants/${tenantId}/members`);

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  return { message: "メンバーを削除しました。", ok: true };
};

export const createTenantAdminInvitationAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  const email = String(formData.get("invite_email") ?? "").trim();

  const result = await createPlatformTenantAdminInvitation(
    tenantId,
    email
  );

  revalidatePath(`/tenants/${tenantId}`);
  revalidatePath(`/tenants/${tenantId}/members`);

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
  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  const invitationId = String(formData.get("invitation_id") ?? "").trim();

  const result = await resendPlatformTenantAdminInvitation(
    tenantId,
    invitationId
  );

  revalidatePath(`/tenants/${tenantId}`);
  revalidatePath(`/tenants/${tenantId}/members`);

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  return { message: "招待メールを再送しました。", ok: true };
};

export const cancelTenantAdminInvitationAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  const invitationId = String(formData.get("invitation_id") ?? "").trim();

  const result = await cancelPlatformTenantAdminInvitation(
    tenantId,
    invitationId
  );

  revalidatePath(`/tenants/${tenantId}`);
  revalidatePath(`/tenants/${tenantId}/members`);

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  return { message: "招待を取り消しました。", ok: true };
};
