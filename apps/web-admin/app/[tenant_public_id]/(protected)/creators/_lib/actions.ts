"use server";

import { updateTag } from "next/cache";
import { redirect } from "next/navigation";

import { createCreator, updateCreator } from "#lib/creator";

import type { CreatorActionState } from "../creator-types";

const parseCommonFields = (formData: FormData) => {
  const tenantPublicId = String(formData.get("tenant_public_id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const profileText = String(formData.get("profile_text") ?? "").trim();

  return {
    name,
    profileText,
    tenantPublicId,
  };
};

const validateCommonFields = (
  input: ReturnType<typeof parseCommonFields>,
  mode: "create" | "update"
): CreatorActionState | null => {
  if (!input.tenantPublicId) {
    return {
      message: "テナント ID が見つかりません。",
      mode,
      ok: false,
    };
  }

  if (!input.name) {
    return {
      message: "名前は必須です。",
      mode,
      ok: false,
    };
  }

  return null;
};

export const createCreatorAction = async (
  _prevState: CreatorActionState,
  formData: FormData
): Promise<CreatorActionState> => {
  const input = parseCommonFields(formData);
  const commonValidation = validateCommonFields(input, "create");
  if (commonValidation) {
    return commonValidation;
  }

  const result = await createCreator({
    name: input.name,
    profileText: input.profileText,
    tenantPublicId: input.tenantPublicId,
  });

  if (!result.ok) {
    return {
      message: result.message,
      mode: "create",
      ok: false,
    };
  }

  updateTag(`creators-${input.tenantPublicId}`);

  redirect(`/creators/${result.creator.publicId}?created=1`);
};

export const updateCreatorAction = async (
  _prevState: CreatorActionState,
  formData: FormData
): Promise<CreatorActionState> => {
  const input = parseCommonFields(formData);
  const commonValidation = validateCommonFields(input, "update");
  if (commonValidation) {
    return commonValidation;
  }

  const publicId = String(formData.get("public_id") ?? "").trim();
  if (!publicId) {
    return {
      message: "更新対象の著者 ID が見つかりません。",
      mode: "update",
      ok: false,
    };
  }

  const result = await updateCreator({
    name: input.name,
    profileText: input.profileText,
    publicId,
    tenantPublicId: input.tenantPublicId,
  });

  if (!result.ok) {
    return {
      message: result.message,
      mode: "update",
      ok: false,
    };
  }

  updateTag(`creators-${input.tenantPublicId}`);
  updateTag(`creator-${input.tenantPublicId}-${publicId}`);

  return {
    creator: result.creator,
    message: "著者を更新しました。",
    mode: "update",
    ok: true,
  };
};
