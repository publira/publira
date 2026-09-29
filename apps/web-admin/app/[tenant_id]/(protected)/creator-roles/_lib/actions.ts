"use server";

import type { Locale } from "@publira/i18n";
import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { z } from "zod";

import { getActionLocale } from "#lib/action-messages";
import { withAdminSessionReauth } from "#lib/auth-session";
import {
  createCreatorRole,
  creatorRolesCacheTag,
  deleteCreatorRole,
  reorderCreatorRoles,
  updateCreatorRole,
} from "#lib/creator-roles";
import { CREATOR_ROLE_NAME_MAX_LENGTH } from "#lib/creator-roles-shared";
import { assertSameOrigin } from "#lib/csrf";
import {
  jsonRecordIdArrayFormSchema,
  requiredRecordId,
  requiredTrimmedString,
} from "#lib/form-schemas";
import { getMessagesFor } from "#lib/messages";

import type {
  CreatorRoleReorderResult,
  CreatorRoleRowActionState,
} from "../creator-role-types";

const nameSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return requiredTrimmedString(
    t("admin.creator_roles.validation.name_required"),
    CREATOR_ROLE_NAME_MAX_LENGTH,
    t("admin.creator_roles.validation.name_too_long", {
      count: String(CREATOR_ROLE_NAME_MAX_LENGTH),
    })
  );
};
const tenantIdSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return requiredTrimmedString(
    t("admin.creator_roles.validation.tenant_missing")
  );
};
const idSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return requiredRecordId(t("admin.creator_roles.validation.id_missing"));
};
const createCreatorRoleSchema = async (locale: Locale) =>
  z.object({
    name: await nameSchema(locale),
    tenantId: await tenantIdSchema(locale),
  });
const renameCreatorRoleSchema = async (locale: Locale) =>
  z.object({
    id: await idSchema(locale),
    name: await nameSchema(locale),
    tenantId: await tenantIdSchema(locale),
  });
const deleteCreatorRoleSchema = async (locale: Locale) =>
  z.object({
    id: await idSchema(locale),
    tenantId: await tenantIdSchema(locale),
  });
const reorderCreatorRolesSchema = async (locale: Locale) =>
  z.object({
    expectedIds: jsonRecordIdArrayFormSchema,
    ids: jsonRecordIdArrayFormSchema,
    tenantId: await tenantIdSchema(locale),
  });
const rowFormFields = {
  id: { kind: "value", name: "creator_role_id" },
  tenantId: { kind: "value", name: "tenant_id" },
} as const;

export const createCreatorRoleAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    createCreatorRoleSchema(locale),
  ]);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      name: "value",
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const { name, tenantId } = parsed.data;
  const result = await withAdminSessionReauth(() =>
    createCreatorRole({ name, tenantId }, locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(creatorRolesCacheTag(tenantId));

  return {
    message: t("admin.creator_roles.created"),
    ok: true,
  };
};

export const renameCreatorRoleAction = async (
  _prevState: CreatorRoleRowActionState,
  formData: FormData
): Promise<CreatorRoleRowActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    renameCreatorRoleSchema(locale),
  ]);
  const parsed = schema.safeParse(
    toFormDataInput(formData, { ...rowFormFields, name: "value" })
  );
  if (!parsed.success) {
    // The row the message belongs to is the one that submitted, which is what
    // the form posted — a parse failure has no validated id to echo.
    const id = formData.get("creator_role_id");
    return {
      id: typeof id === "string" ? id : "",
      message: toFormErrorMessage(parsed.error, { locale }),
      ok: false,
    };
  }

  const { name, id, tenantId } = parsed.data;
  const result = await withAdminSessionReauth(() =>
    updateCreatorRole({ id, name, tenantId }, locale)
  );
  if (!result.ok) {
    return { id, message: result.message, ok: false };
  }

  updateTag(creatorRolesCacheTag(tenantId));

  return {
    id,
    message: t("admin.creator_roles.updated"),
    ok: true,
  };
};

export const deleteCreatorRoleAction = async (
  _prevState: CreatorRoleRowActionState,
  formData: FormData
): Promise<CreatorRoleRowActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    deleteCreatorRoleSchema(locale),
  ]);
  const parsed = schema.safeParse(toFormDataInput(formData, rowFormFields));
  if (!parsed.success) {
    const id = formData.get("creator_role_id");
    return {
      id: typeof id === "string" ? id : "",
      message: toFormErrorMessage(parsed.error, { locale }),
      ok: false,
    };
  }

  const { id, tenantId } = parsed.data;
  const result = await withAdminSessionReauth(() =>
    deleteCreatorRole({ id, tenantId }, locale)
  );
  if (!result.ok) {
    return { id, message: result.message, ok: false };
  }

  updateTag(creatorRolesCacheTag(tenantId));

  return {
    id,
    message: t("admin.creator_roles.deleted"),
    ok: true,
  };
};

export const reorderCreatorRolesAction = async (
  formData: FormData
): Promise<CreatorRoleReorderResult> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    reorderCreatorRolesSchema(locale),
  ]);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      expectedIds: {
        kind: "value",
        name: "expected_creator_role_ids",
      },
      ids: { kind: "value", name: "creator_role_ids" },
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, {
        fallback: t("admin.creator_roles.reorder_failed"),
        locale,
      }),
      ok: false,
    };
  }

  const { expectedIds, ids, tenantId } = parsed.data;
  if (ids.length === 0 || ids.length !== expectedIds.length) {
    return {
      message: t("admin.creator_roles.reorder_failed"),
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    reorderCreatorRoles({ expectedIds, ids, tenantId }, locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(creatorRolesCacheTag(tenantId));

  return { ok: true };
};
