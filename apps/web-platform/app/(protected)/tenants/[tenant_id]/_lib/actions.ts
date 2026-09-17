"use server";

import type { Locale } from "@publira/i18n";
import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { z } from "zod";

import { platformAuditLogsCacheTag } from "#lib/audit-logs";
import { emailFormSchema } from "#lib/auth-input";
import { withPlatformSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { platformDashboardCacheTag } from "#lib/dashboard";
import {
  optionalTrimmedString,
  requiredTrimmedString,
} from "#lib/form-schemas";
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import {
  addPlatformTenantMember,
  cancelPlatformTenantAdminInvitation,
  createPlatformTenantAdminInvitation,
  platformTenantCacheTag,
  platformTenantsCacheTag,
  removePlatformTenantMember,
  resendPlatformTenantAdminInvitation,
  resumePlatformTenant,
  suspendPlatformTenant,
  updatePlatformTenant,
  updatePlatformTenantMemberRole,
} from "#lib/tenants";
import { platformEndUsersCacheTag } from "#lib/users";

/**
 * Every schema below takes the `locale` and reads the catalog itself, so no
 * accessor travels as an argument. The read is one cached module import, so
 * composing several of them costs a request nothing.
 */
const tenantIdFormSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return requiredTrimmedString(t("platform.common.required"));
};

const tenantMemberRoleFormSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.enum(["tenant_admin", "tenant_auditor", "tenant_editor"], {
    error: t("platform.common.required"),
  });
};

const tenantIdOnlySchema = async (locale: Locale) => {
  const tenantId = await tenantIdFormSchema(locale);

  return z.object({ tenantId });
};

const updateTenantNameFormSchema = async (locale: Locale) => {
  const [t, tenantId] = await Promise.all([
    getMessagesFor(locale),
    tenantIdFormSchema(locale),
  ]);

  return z.object({
    currentDomain: optionalTrimmedString(),
    name: requiredTrimmedString(t("platform.tenants.name_required")),
    tenantId,
  });
};

const updateTenantDomainFormSchema = async (locale: Locale) => {
  const [t, tenantId] = await Promise.all([
    getMessagesFor(locale),
    tenantIdFormSchema(locale),
  ]);

  return z.object({
    adminDomain: optionalTrimmedString(),
    currentName: requiredTrimmedString(t("platform.common.required")),
    domain: requiredTrimmedString(t("platform.tenants.domain_required")),
    tenantId,
  });
};

const addTenantMemberFormSchema = async (locale: Locale) => {
  const [email, role, tenantId] = await Promise.all([
    emailFormSchema(locale),
    tenantMemberRoleFormSchema(locale),
    tenantIdFormSchema(locale),
  ]);

  return z.object({ email, role, tenantId });
};

const updateTenantMemberRoleFormSchema = async (locale: Locale) => {
  const [t, role, tenantId] = await Promise.all([
    getMessagesFor(locale),
    tenantMemberRoleFormSchema(locale),
    tenantIdFormSchema(locale),
  ]);

  return z.object({
    role,
    tenantId,
    userPublicId: requiredTrimmedString(t("platform.common.required")),
  });
};

const removeTenantMemberFormSchema = async (locale: Locale) => {
  const [t, tenantId] = await Promise.all([
    getMessagesFor(locale),
    tenantIdFormSchema(locale),
  ]);

  return z.object({
    tenantId,
    userPublicId: requiredTrimmedString(t("platform.common.required")),
  });
};

const createInvitationFormSchema = async (locale: Locale) => {
  const [email, tenantId] = await Promise.all([
    emailFormSchema(locale),
    tenantIdFormSchema(locale),
  ]);

  return z.object({ email, tenantId });
};

const invitationIdFormSchema = async (locale: Locale) => {
  const [t, tenantId] = await Promise.all([
    getMessagesFor(locale),
    tenantIdFormSchema(locale),
  ]);

  return z.object({
    invitationId: requiredTrimmedString(t("platform.common.required")),
    tenantId,
  });
};

export const suspendTenantAction = async (
  formData: FormData
): Promise<void> => {
  await assertSameOrigin();
  const locale = await getPlatformLocale();
  const schema = await tenantIdOnlySchema(locale);
  const parsed = schema.safeParse(
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
  updateTag(platformTenantsCacheTag);
  updateTag(platformDashboardCacheTag);
  updateTag(platformAuditLogsCacheTag);
};

export const resumeTenantAction = async (formData: FormData): Promise<void> => {
  await assertSameOrigin();
  const locale = await getPlatformLocale();
  const schema = await tenantIdOnlySchema(locale);
  const parsed = schema.safeParse(
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
  updateTag(platformTenantsCacheTag);
  updateTag(platformDashboardCacheTag);
  updateTag(platformAuditLogsCacheTag);
};

export const updateTenantNameAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getPlatformLocale();
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    updateTenantNameFormSchema(locale),
  ]);
  const parsed = schema.safeParse(
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
  updateTag(platformTenantsCacheTag);
  updateTag(platformEndUsersCacheTag);
  updateTag(platformAuditLogsCacheTag);
  if (!result.ok) {
    return { message: result.message, ok: false };
  }
  return { message: t("platform.common.saved"), ok: true };
};

export const updateTenantDomainAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getPlatformLocale();
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    updateTenantDomainFormSchema(locale),
  ]);
  const parsed = schema.safeParse(
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
  updateTag(platformTenantsCacheTag);
  updateTag(platformAuditLogsCacheTag);
  if (!result.ok) {
    return { message: result.message, ok: false };
  }
  return { message: t("platform.common.saved"), ok: true };
};

export const addTenantMemberAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getPlatformLocale();
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    addTenantMemberFormSchema(locale),
  ]);
  const parsed = schema.safeParse(
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

  updateTag(platformTenantCacheTag(parsed.data.tenantId));
  updateTag(platformEndUsersCacheTag);
  updateTag(platformDashboardCacheTag);

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  return {
    message: t("platform.tenants.add_member_success"),
    ok: true,
  };
};

export const updateTenantMemberRoleAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getPlatformLocale();
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    updateTenantMemberRoleFormSchema(locale),
  ]);
  const parsed = schema.safeParse(
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

  updateTag(platformTenantCacheTag(parsed.data.tenantId));

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  return {
    message: t("platform.tenants.role_updated"),
    ok: true,
  };
};

export const removeTenantMemberAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getPlatformLocale();
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    removeTenantMemberFormSchema(locale),
  ]);
  const parsed = schema.safeParse(
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

  updateTag(platformTenantCacheTag(parsed.data.tenantId));
  updateTag(platformEndUsersCacheTag);
  updateTag(platformDashboardCacheTag);

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  return {
    message: t("platform.tenants.delete_member_success"),
    ok: true,
  };
};

export const createTenantAdminInvitationAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getPlatformLocale();
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    createInvitationFormSchema(locale),
  ]);
  const parsed = schema.safeParse(
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

  updateTag(platformTenantCacheTag(parsed.data.tenantId));
  updateTag(platformEndUsersCacheTag);
  updateTag(platformDashboardCacheTag);
  updateTag(platformAuditLogsCacheTag);

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  if (result.roleGrantedImmediately) {
    return {
      message: t("platform.tenants.existing_admin_added"),
      ok: true,
    };
  }

  return {
    message: t("platform.tenants.invite_sent"),
    ok: true,
  };
};

export const resendTenantAdminInvitationAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getPlatformLocale();
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    invitationIdFormSchema(locale),
  ]);
  const parsed = schema.safeParse(
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

  updateTag(platformTenantCacheTag(parsed.data.tenantId));
  updateTag(platformAuditLogsCacheTag);

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  return {
    message: t("platform.tenants.resend_invite_success"),
    ok: true,
  };
};

export const cancelTenantAdminInvitationAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getPlatformLocale();
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    invitationIdFormSchema(locale),
  ]);
  const parsed = schema.safeParse(
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

  updateTag(platformTenantCacheTag(parsed.data.tenantId));
  updateTag(platformAuditLogsCacheTag);

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  return {
    message: t("platform.tenants.cancel_invite_success"),
    ok: true,
  };
};
