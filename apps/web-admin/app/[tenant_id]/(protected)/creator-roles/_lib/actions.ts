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
  jsonStringArrayFormSchema,
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
const publicIdSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return requiredTrimmedString(t("admin.creator_roles.validation.id_missing"));
};
const createCreatorRoleSchema = async (locale: Locale) =>
  z.object({
    name: await nameSchema(locale),
    tenantId: await tenantIdSchema(locale),
  });
const renameCreatorRoleSchema = async (locale: Locale) =>
  z.object({
    name: await nameSchema(locale),
    publicId: await publicIdSchema(locale),
    tenantId: await tenantIdSchema(locale),
  });
const deleteCreatorRoleSchema = async (locale: Locale) =>
  z.object({
    publicId: await publicIdSchema(locale),
    tenantId: await tenantIdSchema(locale),
  });
const reorderCreatorRolesSchema = async (locale: Locale) =>
  z.object({
    expectedPublicIds: jsonStringArrayFormSchema,
    publicIds: jsonStringArrayFormSchema,
    tenantId: await tenantIdSchema(locale),
  });
const rowFormFields = {
  publicId: { kind: "value", name: "public_id" },
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
    const publicId = formData.get("public_id");
    return {
      message: toFormErrorMessage(parsed.error, { locale }),
      ok: false,
      publicId: typeof publicId === "string" ? publicId : "",
    };
  }

  const { name, publicId, tenantId } = parsed.data;
  const result = await withAdminSessionReauth(() =>
    updateCreatorRole({ name, publicId, tenantId }, locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false, publicId };
  }

  updateTag(creatorRolesCacheTag(tenantId));

  return {
    message: t("admin.creator_roles.updated"),
    ok: true,
    publicId,
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
    const publicId = formData.get("public_id");
    return {
      message: toFormErrorMessage(parsed.error, { locale }),
      ok: false,
      publicId: typeof publicId === "string" ? publicId : "",
    };
  }

  const { publicId, tenantId } = parsed.data;
  const result = await withAdminSessionReauth(() =>
    deleteCreatorRole({ publicId, tenantId }, locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false, publicId };
  }

  updateTag(creatorRolesCacheTag(tenantId));

  return {
    message: t("admin.creator_roles.deleted"),
    ok: true,
    publicId,
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
      expectedPublicIds: {
        kind: "value",
        name: "expected_creator_role_public_ids",
      },
      publicIds: { kind: "value", name: "creator_role_public_ids" },
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

  const { expectedPublicIds, publicIds, tenantId } = parsed.data;
  if (publicIds.length === 0 || publicIds.length !== expectedPublicIds.length) {
    return {
      message: t("admin.creator_roles.reorder_failed"),
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    reorderCreatorRoles({ expectedPublicIds, publicIds, tenantId }, locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(creatorRolesCacheTag(tenantId));

  return { ok: true };
};
