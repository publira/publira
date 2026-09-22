"use server";

import type { Locale } from "@publira/i18n";
import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { z } from "zod";

import { getActionLocale } from "#lib/action-messages";
import { withAdminSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { requiredTrimmedString } from "#lib/form-schemas";
import { getMessagesFor } from "#lib/messages";
import {
  cancelTenantAdminInvitation,
  createTenantAdminInvitation,
  removeTenantMember,
  resendTenantAdminInvitation,
  tenantAdminInvitationsCacheTag,
  tenantMembersCacheTag,
  updateTenantMemberRole,
} from "#lib/tenant-members";

import { TENANT_MEMBER_ROLES } from "../member-roles";

const tenantIdSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return requiredTrimmedString(t("admin.members.validation.tenant_missing"));
};
const memberSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    tenantId: await tenantIdSchema(locale),
    userPublicId: requiredTrimmedString(
      t("admin.members.validation.member_missing")
    ),
  });
};
const memberRoleSchema = async (locale: Locale) => {
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    memberSchema(locale),
  ]);

  return schema.extend({
    role: z.enum(TENANT_MEMBER_ROLES, {
      error: t("admin.members.validation.role_invalid"),
    }),
  });
};
const invitationSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    invitationId: requiredTrimmedString(
      t("admin.members.validation.invitation_missing")
    ),
    tenantId: await tenantIdSchema(locale),
  });
};
const inviteSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    email: requiredTrimmedString(
      t("admin.members.validation.email_required")
    ).pipe(z.email(t("admin.members.invite_email_invalid"))),
    tenantId: await tenantIdSchema(locale),
  });
};

const memberFormFields = {
  tenantId: { kind: "value", name: "tenant_id" },
  userPublicId: { kind: "value", name: "user_public_id" },
} as const;
const invitationFormFields = {
  invitationId: { kind: "value", name: "invitation_id" },
  tenantId: { kind: "value", name: "tenant_id" },
} as const;

export const updateTenantMemberRoleAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    memberRoleSchema(locale),
  ]);
  const parsed = schema.safeParse(
    toFormDataInput(formData, { ...memberFormFields, role: "value" })
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const { role, tenantId, userPublicId } = parsed.data;
  const result = await withAdminSessionReauth(() =>
    updateTenantMemberRole({ role, tenantId, userPublicId }, locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(tenantMembersCacheTag(tenantId));

  return { message: t("admin.members.role_updated"), ok: true };
};

export const removeTenantMemberAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    memberSchema(locale),
  ]);
  const parsed = schema.safeParse(toFormDataInput(formData, memberFormFields));
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const { tenantId, userPublicId } = parsed.data;
  const result = await withAdminSessionReauth(() =>
    removeTenantMember({ tenantId, userPublicId }, locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(tenantMembersCacheTag(tenantId));

  return { message: t("admin.members.removed"), ok: true };
};

export const createTenantAdminInvitationAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    inviteSchema(locale),
  ]);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      email: "value",
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const { email, tenantId } = parsed.data;
  const result = await withAdminSessionReauth(() =>
    createTenantAdminInvitation({ email, tenantId }, locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  // An address that already had an account became an admin on the spot, so
  // the member list changed and no invitation was written.
  if (result.roleGrantedImmediately) {
    updateTag(tenantMembersCacheTag(tenantId));
    return {
      message: t("admin.members.invite_granted", { email }),
      ok: true,
    };
  }

  updateTag(tenantAdminInvitationsCacheTag(tenantId));

  return { message: t("admin.members.invite_sent", { email }), ok: true };
};

export const resendTenantAdminInvitationAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    invitationSchema(locale),
  ]);
  const parsed = schema.safeParse(
    toFormDataInput(formData, invitationFormFields)
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const { invitationId, tenantId } = parsed.data;
  const result = await withAdminSessionReauth(() =>
    resendTenantAdminInvitation({ invitationId, tenantId }, locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(tenantAdminInvitationsCacheTag(tenantId));

  return { message: t("admin.members.resent"), ok: true };
};

export const cancelTenantAdminInvitationAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    invitationSchema(locale),
  ]);
  const parsed = schema.safeParse(
    toFormDataInput(formData, invitationFormFields)
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const { invitationId, tenantId } = parsed.data;
  const result = await withAdminSessionReauth(() =>
    cancelTenantAdminInvitation({ invitationId, tenantId }, locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(tenantAdminInvitationsCacheTag(tenantId));

  return { message: t("admin.members.canceled"), ok: true };
};
