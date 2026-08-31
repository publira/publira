"use server";

import { getMessage } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getActionLocale } from "#lib/action-messages";
import { withAdminSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import {
  flagOneFormSchema,
  optionalFileFormSchema,
  optionalTrimmedString,
  requiredTrimmedString,
} from "#lib/form-schemas";
import { createLabel, updateLabel } from "#lib/label";
import type { AdminMessages } from "#lib/locale";

import type { LabelActionState, LabelMutationMode } from "../label-types";

const labelCommonSchema = (messages: AdminMessages) =>
  z.object({
    eyeCatchImage: optionalFileFormSchema,
    name: requiredTrimmedString(
      getMessage(messages, "admin.labels.validation.name_required")
    ),
    tenantId: requiredTrimmedString(
      getMessage(messages, "admin.labels.validation.tenant_missing")
    ),
  });

const labelUpdateSchema = (messages: AdminMessages) =>
  labelCommonSchema(messages).extend({
    clearEyeCatchImage: flagOneFormSchema,
    currentEyeCatchImageUpdatedAt: optionalTrimmedString(),
    publicId: requiredTrimmedString(
      getMessage(messages, "admin.labels.validation.id_missing")
    ),
  });

const labelFormFields = {
  eyeCatchImage: { kind: "file", name: "eye_catch_image" },
  name: "value",
  tenantId: { kind: "value", name: "tenant_id" },
} as const;

const toFailure = (
  message: string,
  mode: LabelMutationMode
): LabelActionState => ({
  message,
  mode,
  ok: false,
});

const toEyeCatchImage = async (file: File | undefined) => {
  if (!file) {
    return {
      eyeCatchImageContentType: undefined,
      eyeCatchImageData: undefined,
    };
  }

  return {
    eyeCatchImageContentType: file.type || undefined,
    eyeCatchImageData: new Uint8Array(await file.arrayBuffer()),
  };
};

export const createLabelAction = async (
  _prevState: LabelActionState,
  formData: FormData
): Promise<LabelActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const messages = sharedCatalog(locale);
  const parsed = labelCommonSchema(messages).safeParse(
    toFormDataInput(formData, labelFormFields)
  );
  if (!parsed.success) {
    return toFailure(toFormErrorMessage(parsed.error, { locale }), "create");
  }

  const { eyeCatchImage, name, tenantId } = parsed.data;
  const { eyeCatchImageContentType, eyeCatchImageData } =
    await toEyeCatchImage(eyeCatchImage);

  const result = await withAdminSessionReauth(() =>
    createLabel(
      {
        eyeCatchImageContentType,
        eyeCatchImageData,
        name,
        tenantId,
      },
      locale
    )
  );

  if (!result.ok) {
    return toFailure(result.message, "create");
  }

  updateTag(`labels-${tenantId}`);

  redirect(`/labels/${result.label.publicId}?created=1`);
};

export const updateLabelAction = async (
  _prevState: LabelActionState,
  formData: FormData
): Promise<LabelActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const messages = sharedCatalog(locale);
  const parsed = labelUpdateSchema(messages).safeParse(
    toFormDataInput(formData, {
      ...labelFormFields,
      clearEyeCatchImage: { kind: "value", name: "clear_eye_catch_image" },
      currentEyeCatchImageUpdatedAt: {
        kind: "value",
        name: "current_eye_catch_image_updated_at",
      },
      publicId: { kind: "value", name: "public_id" },
    })
  );
  if (!parsed.success) {
    return toFailure(toFormErrorMessage(parsed.error, { locale }), "update");
  }

  const {
    clearEyeCatchImage,
    currentEyeCatchImageUpdatedAt,
    eyeCatchImage,
    name,
    publicId,
    tenantId,
  } = parsed.data;
  const { eyeCatchImageContentType, eyeCatchImageData } =
    await toEyeCatchImage(eyeCatchImage);

  const result = await withAdminSessionReauth(() =>
    updateLabel(
      {
        clearEyeCatchImage,
        eyeCatchImageContentType,
        eyeCatchImageData,
        name,
        publicId,
        tenantId,
      },
      locale
    )
  );

  if (!result.ok) {
    return toFailure(result.message, "update");
  }

  if (
    eyeCatchImageData &&
    !clearEyeCatchImage &&
    (result.label.eyeCatchImageVariants?.length ?? 0) === 0
  ) {
    return toFailure(
      getMessage(messages, "admin.labels.eye_catch_variants_missing"),
      "update"
    );
  }

  if (
    eyeCatchImageData &&
    !clearEyeCatchImage &&
    currentEyeCatchImageUpdatedAt.length > 0 &&
    result.label.eyeCatchImageUpdatedAt === currentEyeCatchImageUpdatedAt
  ) {
    return toFailure(
      getMessage(messages, "admin.labels.eye_catch_upload_not_reflected"),
      "update"
    );
  }

  updateTag(`labels-${tenantId}`);
  updateTag(`label-${tenantId}-${publicId}`);

  return {
    label: result.label,
    message: getMessage(messages, "admin.labels.updated"),
    mode: "update",
    ok: true,
  };
};
