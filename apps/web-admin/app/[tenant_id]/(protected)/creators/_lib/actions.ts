"use server";

import type { Locale } from "@publira/i18n";
import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getActionLocale } from "#lib/action-messages";
import { withAdminSessionReauth } from "#lib/auth-session";
import {
  createCreator,
  linkCreatorAccount,
  unlinkCreatorAccount,
  updateCreator,
} from "#lib/creator";
import { CROP_RECT_FIELD } from "#lib/crop-rect";
import { assertSameOrigin } from "#lib/csrf";
import {
  flagOneFormSchema,
  optionalCropRectFormSchema,
  optionalFileFormSchema,
  optionalTrimmedString,
  requiredRecordId,
  requiredTrimmedString,
} from "#lib/form-schemas";
import { getMessagesFor } from "#lib/messages";

import type { CreatorActionState, CreatorMutationMode } from "../creator-types";

const creatorCommonSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    clearIconImage: flagOneFormSchema,
    iconImage: optionalFileFormSchema,
    iconImageCrop: optionalCropRectFormSchema(t("admin.image_crop.invalid")),
    name: requiredTrimmedString(t("admin.creators.validation.name_required")),
    profileText: optionalTrimmedString(10_000),
    tenantId: requiredTrimmedString(
      t("admin.creators.validation.tenant_missing")
    ),
  });
};
const creatorUpdateSchema = async (locale: Locale) => {
  const [t, base] = await Promise.all([
    getMessagesFor(locale),
    creatorCommonSchema(locale),
  ]);

  return base.extend({
    id: requiredRecordId(t("admin.creators.validation.id_missing")),
  });
};
const creatorFormFields = {
  clearIconImage: { kind: "value", name: "clear_icon_image" },
  iconImage: { kind: "file", name: "icon_image" },
  iconImageCrop: { kind: "value", name: CROP_RECT_FIELD },
  name: "value",
  profileText: { kind: "value", name: "profile_text" },
  tenantId: { kind: "value", name: "tenant_id" },
} as const;

const toFailure = (
  message: string,
  mode: CreatorMutationMode
): CreatorActionState => ({
  message,
  mode,
  ok: false,
});

const toIconImage = async (file: File | undefined) => {
  if (!file) {
    return { iconImageContentType: undefined, iconImageData: undefined };
  }

  return {
    iconImageContentType: file.type || undefined,
    iconImageData: new Uint8Array(await file.arrayBuffer()),
  };
};

export const createCreatorAction = async (
  _prevState: CreatorActionState,
  formData: FormData
): Promise<CreatorActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const schema = await creatorCommonSchema(locale);
  const parsed = schema.safeParse(toFormDataInput(formData, creatorFormFields));
  if (!parsed.success) {
    return toFailure(toFormErrorMessage(parsed.error, { locale }), "create");
  }

  const { iconImage, iconImageCrop, name, profileText, tenantId } = parsed.data;
  const { iconImageContentType, iconImageData } = await toIconImage(iconImage);

  const result = await withAdminSessionReauth(() =>
    createCreator(
      {
        iconImageContentType,
        iconImageCrop,
        iconImageData,
        name,
        profileText,
        tenantId,
      },
      locale
    )
  );

  if (!result.ok) {
    return toFailure(result.message, "create");
  }

  updateTag(`creators-${tenantId}`);

  redirect(`/creators/${result.creator.publicId}?created=1`);
};

export const updateCreatorAction = async (
  _prevState: CreatorActionState,
  formData: FormData
): Promise<CreatorActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    creatorUpdateSchema(locale),
  ]);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      ...creatorFormFields,
      id: { kind: "value", name: "creator_id" },
    })
  );
  if (!parsed.success) {
    return toFailure(toFormErrorMessage(parsed.error, { locale }), "update");
  }

  const {
    clearIconImage,
    iconImage,
    iconImageCrop,
    id,
    name,
    profileText,
    tenantId,
  } = parsed.data;
  const { iconImageContentType, iconImageData } = await toIconImage(iconImage);

  const result = await withAdminSessionReauth(() =>
    updateCreator(
      {
        clearIconImage,
        iconImageContentType,
        iconImageCrop,
        iconImageData,
        id,
        name,
        profileText,
        tenantId,
      },
      locale
    )
  );

  if (!result.ok) {
    return toFailure(result.message, "update");
  }

  updateTag(`creators-${tenantId}`);
  updateTag(`creator-${tenantId}-${result.creator.publicId}`);

  return {
    creator: result.creator,
    message: t("admin.creators.updated"),
    mode: "update",
    ok: true,
  };
};

const creatorAccountSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    creatorId: requiredRecordId(
      t("admin.creators.accounts.validation.creator_missing")
    ),
    creatorPublicId: requiredTrimmedString(
      t("admin.creators.accounts.validation.creator_missing")
    ),
    readerId: requiredRecordId(
      t("admin.creators.accounts.validation.reader_required")
    ),
    tenantId: requiredTrimmedString(
      t("admin.creators.validation.tenant_missing")
    ),
  });
};
const creatorAccountFormFields = {
  creatorId: { kind: "value", name: "creator_id" },
  creatorPublicId: { kind: "value", name: "creator_public_id" },
  readerId: { kind: "value", name: "reader_id" },
  tenantId: { kind: "value", name: "tenant_id" },
} as const;

export const linkCreatorAccountAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    creatorAccountSchema(locale),
  ]);
  const parsed = schema.safeParse(
    toFormDataInput(formData, creatorAccountFormFields)
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const { creatorId, creatorPublicId, readerId, tenantId } = parsed.data;
  const result = await withAdminSessionReauth(() =>
    linkCreatorAccount({ creatorId, readerId, tenantId }, locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(`creator-${tenantId}-${creatorPublicId}`);

  const account = result.accounts.find((item) => item.id === readerId);
  return {
    message: t("admin.creators.accounts.linked", {
      name: account?.name || account?.email || "",
    }),
    ok: true,
  };
};

export const unlinkCreatorAccountAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    creatorAccountSchema(locale),
  ]);
  const parsed = schema.safeParse(
    toFormDataInput(formData, creatorAccountFormFields)
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const { creatorId, creatorPublicId, readerId, tenantId } = parsed.data;
  const result = await withAdminSessionReauth(() =>
    unlinkCreatorAccount({ creatorId, readerId, tenantId }, locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(`creator-${tenantId}-${creatorPublicId}`);

  return { message: t("admin.creators.accounts.unlinked"), ok: true };
};
