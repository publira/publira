"use server";

import { getMessage } from "@publira/i18n";
import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { emailFormSchema } from "#lib/auth-input";
import { withPlatformSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import {
  optionalTrimmedString,
  requiredTrimmedString,
} from "#lib/form-schemas";
import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";
import type { PlatformMessages } from "#lib/locale";
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

const requiredMessage = (messages: PlatformMessages) =>
  getMessage(messages, "platform.common.required");

const tenantIdFormSchema = (messages: PlatformMessages) =>
  requiredTrimmedString(requiredMessage(messages));

const tenantMemberRoleFormSchema = (messages: PlatformMessages) =>
  z.enum(["tenant_admin", "tenant_auditor", "tenant_editor"], {
    error: requiredMessage(messages),
  });

const tenantIdOnlySchema = (messages: PlatformMessages) =>
  z.object({
    tenantId: tenantIdFormSchema(messages),
  });

const updateTenantNameFormSchema = (messages: PlatformMessages) =>
  z.object({
    currentDomain: optionalTrimmedString(),
    name: requiredTrimmedString(
      getMessage(messages, "platform.tenants.name_required")
    ),
    tenantId: tenantIdFormSchema(messages),
  });

const updateTenantDomainFormSchema = (messages: PlatformMessages) =>
  z.object({
    adminDomain: optionalTrimmedString(),
    currentName: requiredTrimmedString(requiredMessage(messages)),
    domain: requiredTrimmedString(
      getMessage(messages, "platform.tenants.domain_required")
    ),
    tenantId: tenantIdFormSchema(messages),
  });

const addTenantMemberFormSchema = (messages: PlatformMessages) =>
  z.object({
    email: emailFormSchema(messages),
    role: tenantMemberRoleFormSchema(messages),
    tenantId: tenantIdFormSchema(messages),
  });

const updateTenantMemberRoleFormSchema = (messages: PlatformMessages) =>
  z.object({
    role: tenantMemberRoleFormSchema(messages),
    tenantId: tenantIdFormSchema(messages),
    userPublicId: requiredTrimmedString(requiredMessage(messages)),
  });

const removeTenantMemberFormSchema = (messages: PlatformMessages) =>
  z.object({
    tenantId: tenantIdFormSchema(messages),
    userPublicId: requiredTrimmedString(requiredMessage(messages)),
  });

const createInvitationFormSchema = (messages: PlatformMessages) =>
  z.object({
    email: emailFormSchema(messages),
    tenantId: tenantIdFormSchema(messages),
  });

const invitationIdFormSchema = (messages: PlatformMessages) =>
  z.object({
    invitationId: requiredTrimmedString(requiredMessage(messages)),
    tenantId: tenantIdFormSchema(messages),
  });

const revalidateTenantMemberPaths = (tenantId: string) => {
  revalidatePath(`/tenants/${tenantId}`);
  revalidatePath(`/tenants/${tenantId}/members`);
};

export const suspendTenantAction = async (
  formData: FormData
): Promise<void> => {
  await assertSameOrigin();
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  const parsed = tenantIdOnlySchema(messages).safeParse(
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
  await assertSameOrigin();
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  const parsed = tenantIdOnlySchema(messages).safeParse(
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
  await assertSameOrigin();
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  const parsed = updateTenantNameFormSchema(messages).safeParse(
    toFormDataInput(formData, {
      currentDomain: { kind: "value", name: "tenant_current_domain" },
      name: { kind: "value", name: "tenant_name" },
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const result = await withPlatformSessionReauth(() =>
    updatePlatformTenant(
      parsed.data.tenantId,
      parsed.data.name,
      parsed.data.currentDomain,
      locale
    )
  );
  revalidatePath(`/tenants/${parsed.data.tenantId}`);
  if (!result.ok) {
    return { message: result.message, ok: false };
  }
  return { message: getMessage(messages, "platform.common.saved"), ok: true };
};

export const updateTenantDomainAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  const parsed = updateTenantDomainFormSchema(messages).safeParse(
    toFormDataInput(formData, {
      adminDomain: { kind: "value", name: "tenant_admin_domain" },
      currentName: { kind: "value", name: "tenant_current_name" },
      domain: { kind: "value", name: "tenant_domain" },
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const result = await withPlatformSessionReauth(() =>
    updatePlatformTenant(
      parsed.data.tenantId,
      parsed.data.currentName,
      parsed.data.domain,
      locale,
      parsed.data.adminDomain
    )
  );
  revalidatePath(`/tenants/${parsed.data.tenantId}`);
  if (!result.ok) {
    return { message: result.message, ok: false };
  }
  return { message: getMessage(messages, "platform.common.saved"), ok: true };
};

export const addTenantMemberAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  const parsed = addTenantMemberFormSchema(messages).safeParse(
    toFormDataInput(formData, {
      email: { kind: "value", name: "member_email" },
      role: { kind: "value", name: "member_role" },
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const result = await withPlatformSessionReauth(() =>
    addPlatformTenantMember({ ...parsed.data, locale })
  );

  revalidateTenantMemberPaths(parsed.data.tenantId);

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  return {
    message: getMessage(messages, "platform.tenants.add_member_success"),
    ok: true,
  };
};

export const updateTenantMemberRoleAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  const parsed = updateTenantMemberRoleFormSchema(messages).safeParse(
    toFormDataInput(formData, {
      role: { kind: "value", name: "member_role" },
      tenantId: { kind: "value", name: "tenant_id" },
      userPublicId: { kind: "value", name: "member_user_public_id" },
    })
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const result = await withPlatformSessionReauth(() =>
    updatePlatformTenantMemberRole(
      parsed.data.tenantId,
      parsed.data.userPublicId,
      parsed.data.role,
      locale
    )
  );

  revalidateTenantMemberPaths(parsed.data.tenantId);

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  return {
    message: getMessage(messages, "platform.tenants.role_updated"),
    ok: true,
  };
};

export const removeTenantMemberAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  const parsed = removeTenantMemberFormSchema(messages).safeParse(
    toFormDataInput(formData, {
      tenantId: { kind: "value", name: "tenant_id" },
      userPublicId: { kind: "value", name: "member_user_public_id" },
    })
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const result = await withPlatformSessionReauth(() =>
    removePlatformTenantMember(
      parsed.data.tenantId,
      parsed.data.userPublicId,
      locale
    )
  );

  revalidateTenantMemberPaths(parsed.data.tenantId);

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  return {
    message: getMessage(messages, "platform.tenants.delete_member_success"),
    ok: true,
  };
};

export const createTenantAdminInvitationAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  const parsed = createInvitationFormSchema(messages).safeParse(
    toFormDataInput(formData, {
      email: { kind: "value", name: "invite_email" },
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const result = await withPlatformSessionReauth(() =>
    createPlatformTenantAdminInvitation(
      parsed.data.tenantId,
      parsed.data.email,
      locale
    )
  );

  revalidateTenantMemberPaths(parsed.data.tenantId);

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  if (result.roleGrantedImmediately) {
    return {
      message: getMessage(messages, "platform.tenants.existing_admin_added"),
      ok: true,
    };
  }

  return {
    message: getMessage(messages, "platform.tenants.invite_sent"),
    ok: true,
  };
};

export const resendTenantAdminInvitationAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  const parsed = invitationIdFormSchema(messages).safeParse(
    toFormDataInput(formData, {
      invitationId: { kind: "value", name: "invitation_id" },
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const result = await withPlatformSessionReauth(() =>
    resendPlatformTenantAdminInvitation(
      parsed.data.tenantId,
      parsed.data.invitationId,
      locale
    )
  );

  revalidateTenantMemberPaths(parsed.data.tenantId);

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  return {
    message: getMessage(messages, "platform.tenants.resend_invite_success"),
    ok: true,
  };
};

export const cancelTenantAdminInvitationAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  const parsed = invitationIdFormSchema(messages).safeParse(
    toFormDataInput(formData, {
      invitationId: { kind: "value", name: "invitation_id" },
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const result = await withPlatformSessionReauth(() =>
    cancelPlatformTenantAdminInvitation(
      parsed.data.tenantId,
      parsed.data.invitationId,
      locale
    )
  );

  revalidateTenantMemberPaths(parsed.data.tenantId);

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  return {
    message: getMessage(messages, "platform.tenants.cancel_invite_success"),
    ok: true,
  };
};
