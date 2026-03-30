"use server";

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
} from "../../../../../lib/tenants";
import type { TenantUpdateFormState } from "../_components/tenant-update-form";

export type TenantMemberFormState = { ok: boolean; message: string } | null;
export type TenantInvitationFormState = { ok: boolean; message: string } | null;

export const suspendTenantAction = async (
  formData: FormData
): Promise<void> => {
  const tenantPublicId = String(formData.get("tenant_public_id") ?? "").trim();
  if (!tenantPublicId) {
    return;
  }

  await suspendPlatformTenant(tenantPublicId);
  revalidatePath(`/tenants/${tenantPublicId}`);
  revalidatePath("/tenants");
};

export const resumeTenantAction = async (formData: FormData): Promise<void> => {
  const tenantPublicId = String(formData.get("tenant_public_id") ?? "").trim();
  if (!tenantPublicId) {
    return;
  }

  await resumePlatformTenant(tenantPublicId);
  revalidatePath(`/tenants/${tenantPublicId}`);
  revalidatePath("/tenants");
};

export const updateTenantNameAction = async (
  _prevState: TenantUpdateFormState,
  formData: FormData
): Promise<TenantUpdateFormState> => {
  const tenantPublicId = String(formData.get("tenant_public_id") ?? "").trim();
  const name = String(formData.get("tenant_name") ?? "").trim();
  const currentDomain = String(
    formData.get("tenant_current_domain") ?? ""
  ).trim();
  if (!tenantPublicId || !name) {
    return { message: "必須項目が入力されていません。", ok: false };
  }

  const result = await updatePlatformTenant(
    tenantPublicId,
    name,
    currentDomain
  );
  revalidatePath(`/tenants/${tenantPublicId}`);
  if (!result.ok) {
    return { message: result.message, ok: false };
  }
  return { message: "保存しました。", ok: true };
};

export const updateTenantDomainAction = async (
  _prevState: TenantUpdateFormState,
  formData: FormData
): Promise<TenantUpdateFormState> => {
  const tenantPublicId = String(formData.get("tenant_public_id") ?? "").trim();
  const currentName = String(formData.get("tenant_current_name") ?? "").trim();
  const domain = String(formData.get("tenant_domain") ?? "").trim();
  const adminDomain = String(formData.get("tenant_admin_domain") ?? "").trim();
  if (!tenantPublicId || !currentName) {
    return { message: "必須項目が入力されていません。", ok: false };
  }
  if (!domain) {
    return { message: "ドメインは必須です。", ok: false };
  }

  const result = await updatePlatformTenant(
    tenantPublicId,
    currentName,
    domain,
    adminDomain
  );
  revalidatePath(`/tenants/${tenantPublicId}`);
  if (!result.ok) {
    return { message: result.message, ok: false };
  }
  return { message: "保存しました。", ok: true };
};

export const addTenantMemberAction = async (
  _prevState: TenantMemberFormState,
  formData: FormData
): Promise<TenantMemberFormState> => {
  const tenantPublicId = String(formData.get("tenant_public_id") ?? "").trim();
  const email = String(formData.get("member_email") ?? "").trim();
  const role = String(formData.get("member_role") ?? "").trim();

  const result = await addPlatformTenantMember({
    email,
    role,
    tenantPublicId,
  });

  revalidatePath(`/tenants/${tenantPublicId}`);
  revalidatePath(`/tenants/${tenantPublicId}/members`);

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  return { message: "メンバーを追加しました。", ok: true };
};

export const updateTenantMemberRoleAction = async (
  _prevState: TenantMemberFormState,
  formData: FormData
): Promise<TenantMemberFormState> => {
  const tenantPublicId = String(formData.get("tenant_public_id") ?? "").trim();
  const userPublicId = String(
    formData.get("member_user_public_id") ?? ""
  ).trim();
  const role = String(formData.get("member_role") ?? "").trim();

  const result = await updatePlatformTenantMemberRole(
    tenantPublicId,
    userPublicId,
    role
  );

  revalidatePath(`/tenants/${tenantPublicId}`);
  revalidatePath(`/tenants/${tenantPublicId}/members`);

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  return { message: "ロールを更新しました。", ok: true };
};

export const removeTenantMemberAction = async (
  _prevState: TenantMemberFormState,
  formData: FormData
): Promise<TenantMemberFormState> => {
  const tenantPublicId = String(formData.get("tenant_public_id") ?? "").trim();
  const userPublicId = String(
    formData.get("member_user_public_id") ?? ""
  ).trim();

  const result = await removePlatformTenantMember(tenantPublicId, userPublicId);

  revalidatePath(`/tenants/${tenantPublicId}`);
  revalidatePath(`/tenants/${tenantPublicId}/members`);

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  return { message: "メンバーを削除しました。", ok: true };
};

export const createTenantAdminInvitationAction = async (
  _prevState: TenantInvitationFormState,
  formData: FormData
): Promise<TenantInvitationFormState> => {
  const tenantPublicId = String(formData.get("tenant_public_id") ?? "").trim();
  const email = String(formData.get("invite_email") ?? "").trim();

  const result = await createPlatformTenantAdminInvitation(tenantPublicId, email);

  revalidatePath(`/tenants/${tenantPublicId}`);
  revalidatePath(`/tenants/${tenantPublicId}/members`);

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
  _prevState: TenantInvitationFormState,
  formData: FormData
): Promise<TenantInvitationFormState> => {
  const tenantPublicId = String(formData.get("tenant_public_id") ?? "").trim();
  const invitationId = String(formData.get("invitation_id") ?? "").trim();

  const result = await resendPlatformTenantAdminInvitation(
    tenantPublicId,
    invitationId
  );

  revalidatePath(`/tenants/${tenantPublicId}`);
  revalidatePath(`/tenants/${tenantPublicId}/members`);

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  return { message: "招待メールを再送しました。", ok: true };
};

export const cancelTenantAdminInvitationAction = async (
  _prevState: TenantInvitationFormState,
  formData: FormData
): Promise<TenantInvitationFormState> => {
  const tenantPublicId = String(formData.get("tenant_public_id") ?? "").trim();
  const invitationId = String(formData.get("invitation_id") ?? "").trim();

  const result = await cancelPlatformTenantAdminInvitation(
    tenantPublicId,
    invitationId
  );

  revalidatePath(`/tenants/${tenantPublicId}`);
  revalidatePath(`/tenants/${tenantPublicId}/members`);

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  return { message: "招待を取り消しました。", ok: true };
};
