"use server";

import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { withAdminSessionReauth } from "#lib/auth-session";
import { createCreator, updateCreator } from "#lib/creator";
import { assertSameOrigin } from "#lib/csrf";
import {
  flagOneFormSchema,
  optionalFileFormSchema,
  optionalTrimmedString,
  requiredTrimmedString,
} from "#lib/form-schemas";

import type { CreatorActionState, CreatorMutationMode } from "../creator-types";

const creatorCommonSchema = z.object({
  clearIconImage: flagOneFormSchema,
  iconImage: optionalFileFormSchema,
  name: requiredTrimmedString("名前は必須です。"),
  profileText: optionalTrimmedString(10_000),
  tenantId: requiredTrimmedString("テナント ID が見つかりません。"),
});

const creatorUpdateSchema = creatorCommonSchema.extend({
  publicId: requiredTrimmedString("更新対象の著者 ID が見つかりません。"),
});

const creatorFormFields = {
  clearIconImage: { kind: "value", name: "clear_icon_image" },
  iconImage: { kind: "file", name: "icon_image" },
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
  const parsed = creatorCommonSchema.safeParse(
    toFormDataInput(formData, creatorFormFields)
  );
  if (!parsed.success) {
    return toFailure(toFormErrorMessage(parsed.error), "create");
  }

  const { iconImage, name, profileText, tenantId } = parsed.data;
  const { iconImageContentType, iconImageData } = await toIconImage(iconImage);

  const result = await withAdminSessionReauth(() =>
    createCreator({
      iconImageContentType,
      iconImageData,
      name,
      profileText,
      tenantId,
    })
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
  const parsed = creatorUpdateSchema.safeParse(
    toFormDataInput(formData, {
      ...creatorFormFields,
      publicId: { kind: "value", name: "public_id" },
    })
  );
  if (!parsed.success) {
    return toFailure(toFormErrorMessage(parsed.error), "update");
  }

  const { clearIconImage, iconImage, name, profileText, publicId, tenantId } =
    parsed.data;
  const { iconImageContentType, iconImageData } = await toIconImage(iconImage);

  const result = await withAdminSessionReauth(() =>
    updateCreator({
      clearIconImage,
      iconImageContentType,
      iconImageData,
      name,
      profileText,
      publicId,
      tenantId,
    })
  );

  if (!result.ok) {
    return toFailure(result.message, "update");
  }

  updateTag(`creators-${tenantId}`);
  updateTag(`creator-${tenantId}-${publicId}`);

  return {
    creator: result.creator,
    message: "著者を更新しました。",
    mode: "update",
    ok: true,
  };
};
