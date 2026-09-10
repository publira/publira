"use server";

import { getMessage } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
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
import type { AdminMessages } from "#lib/locale";

import type {
  CreatorRoleReorderResult,
  CreatorRoleRowActionState,
} from "../creator-role-types";

const nameSchema = (messages: AdminMessages) =>
  requiredTrimmedString(
    getMessage(messages, "admin.creator_roles.validation.name_required"),
    CREATOR_ROLE_NAME_MAX_LENGTH,
    getMessage(messages, "admin.creator_roles.validation.name_too_long", {
      count: String(CREATOR_ROLE_NAME_MAX_LENGTH),
    })
  );

const tenantIdSchema = (messages: AdminMessages) =>
  requiredTrimmedString(
    getMessage(messages, "admin.creator_roles.validation.tenant_missing")
  );

const publicIdSchema = (messages: AdminMessages) =>
  requiredTrimmedString(
    getMessage(messages, "admin.creator_roles.validation.id_missing")
  );

const createCreatorRoleSchema = (messages: AdminMessages) =>
  z.object({
    name: nameSchema(messages),
    tenantId: tenantIdSchema(messages),
  });

const renameCreatorRoleSchema = (messages: AdminMessages) =>
  z.object({
    name: nameSchema(messages),
    publicId: publicIdSchema(messages),
    tenantId: tenantIdSchema(messages),
  });

const deleteCreatorRoleSchema = (messages: AdminMessages) =>
  z.object({
    publicId: publicIdSchema(messages),
    tenantId: tenantIdSchema(messages),
  });

const reorderCreatorRolesSchema = (messages: AdminMessages) =>
  z.object({
    expectedPublicIds: jsonStringArrayFormSchema,
    publicIds: jsonStringArrayFormSchema,
    tenantId: tenantIdSchema(messages),
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
  const messages = sharedCatalog(locale);
  const parsed = createCreatorRoleSchema(messages).safeParse(
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
    message: getMessage(messages, "admin.creator_roles.created"),
    ok: true,
  };
};

export const renameCreatorRoleAction = async (
  _prevState: CreatorRoleRowActionState,
  formData: FormData
): Promise<CreatorRoleRowActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const messages = sharedCatalog(locale);
  const parsed = renameCreatorRoleSchema(messages).safeParse(
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
    message: getMessage(messages, "admin.creator_roles.updated"),
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
  const messages = sharedCatalog(locale);
  const parsed = deleteCreatorRoleSchema(messages).safeParse(
    toFormDataInput(formData, rowFormFields)
  );
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
    message: getMessage(messages, "admin.creator_roles.deleted"),
    ok: true,
    publicId,
  };
};

export const reorderCreatorRolesAction = async (
  formData: FormData
): Promise<CreatorRoleReorderResult> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const messages = sharedCatalog(locale);
  const parsed = reorderCreatorRolesSchema(messages).safeParse(
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
        fallback: getMessage(messages, "admin.creator_roles.reorder_failed"),
        locale,
      }),
      ok: false,
    };
  }

  const { expectedPublicIds, publicIds, tenantId } = parsed.data;
  if (publicIds.length === 0 || publicIds.length !== expectedPublicIds.length) {
    return {
      message: getMessage(messages, "admin.creator_roles.reorder_failed"),
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
