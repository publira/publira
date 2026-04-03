"use server";

import { updateTag } from "next/cache";
import { redirect } from "next/navigation";

import { createLabel, updateLabel } from "#lib/label";

import type { LabelActionState } from "../label-types";

const parseCommonFields = (formData: FormData) => {
  const tenantPublicId = String(formData.get("tenant_public_id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();

  return {
    name,
    tenantPublicId,
  };
};

const validateCommonFields = (
  input: ReturnType<typeof parseCommonFields>,
  mode: "create" | "update"
): LabelActionState | null => {
  if (!input.tenantPublicId) {
    return {
      message: "テナント ID が見つかりません。",
      mode,
      ok: false,
    };
  }

  if (!input.name) {
    return {
      message: "レーベル名は必須です。",
      mode,
      ok: false,
    };
  }

  return null;
};

export const createLabelAction = async (
  _prevState: LabelActionState,
  formData: FormData
): Promise<LabelActionState> => {
  const input = parseCommonFields(formData);
  const commonValidation = validateCommonFields(input, "create");
  if (commonValidation) {
    return commonValidation;
  }

  const result = await createLabel({
    name: input.name,
    tenantPublicId: input.tenantPublicId,
  });

  if (!result.ok) {
    return {
      message: result.message,
      mode: "create",
      ok: false,
    };
  }

  updateTag(`labels-${input.tenantPublicId}`);

  redirect(`/labels/${result.label.publicId}?created=1`);
};

export const updateLabelAction = async (
  _prevState: LabelActionState,
  formData: FormData
): Promise<LabelActionState> => {
  const input = parseCommonFields(formData);
  const commonValidation = validateCommonFields(input, "update");
  if (commonValidation) {
    return commonValidation;
  }

  const publicId = String(formData.get("public_id") ?? "").trim();
  if (!publicId) {
    return {
      message: "更新対象のレーベル ID が見つかりません。",
      mode: "update",
      ok: false,
    };
  }

  const result = await updateLabel({
    name: input.name,
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

  updateTag(`labels-${input.tenantPublicId}`);
  updateTag(`label-${input.tenantPublicId}-${publicId}`);

  return {
    label: result.label,
    message: "レーベルを更新しました。",
    mode: "update",
    ok: true,
  };
};
