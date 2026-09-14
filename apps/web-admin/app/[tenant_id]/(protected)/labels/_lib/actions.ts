"use server";

import type { Locale } from "@publira/i18n";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { EyeCatchAspectActionState } from "#components/eye-catch/types";
import { getActionLocale } from "#lib/action-messages";
import { withAdminSessionReauth } from "#lib/auth-session";
import { CROP_RECT_FIELD } from "#lib/crop-rect";
import { assertSameOrigin } from "#lib/csrf";
import {
  flagOneFormSchema,
  optionalCropRectFormSchema,
  optionalFileFormSchema,
  optionalTrimmedString,
  requiredTrimmedString,
} from "#lib/form-schemas";
import {
  createLabel,
  updateLabel,
  uploadLabelEyeCatchAspectImage,
} from "#lib/label";
import { getMessagesFor } from "#lib/messages";

import type { LabelActionState, LabelMutationMode } from "../label-types";

const labelCommonSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    eyeCatchImage: optionalFileFormSchema,
    name: requiredTrimmedString(t("admin.labels.validation.name_required")),
    tenantId: requiredTrimmedString(
      t("admin.labels.validation.tenant_missing")
    ),
  });
};
const labelUpdateSchema = async (locale: Locale) => {
  const [t, base] = await Promise.all([
    getMessagesFor(locale),
    labelCommonSchema(locale),
  ]);

  return base.extend({
    clearEyeCatchImage: flagOneFormSchema,
    currentEyeCatchImageUpdatedAt: optionalTrimmedString(),
    publicId: requiredTrimmedString(t("admin.labels.validation.id_missing")),
  });
};
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
  const schema = await labelCommonSchema(locale);
  const parsed = schema.safeParse(toFormDataInput(formData, labelFormFields));
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
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    labelUpdateSchema(locale),
  ]);
  const parsed = schema.safeParse(
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
    return toFailure(t("admin.labels.eye_catch_variants_missing"), "update");
  }

  if (
    eyeCatchImageData &&
    !clearEyeCatchImage &&
    currentEyeCatchImageUpdatedAt.length > 0 &&
    result.label.eyeCatchImageUpdatedAt === currentEyeCatchImageUpdatedAt
  ) {
    return toFailure(
      t("admin.labels.eye_catch_upload_not_reflected"),
      "update"
    );
  }

  updateTag(`labels-${tenantId}`);
  updateTag(`label-${tenantId}-${publicId}`);

  return {
    label: result.label,
    message: t("admin.labels.updated"),
    mode: "update",
    ok: true,
  };
};

const eyeCatchAspectSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    crop: optionalCropRectFormSchema(t("admin.image_crop.invalid")),
    publicId: requiredTrimmedString(t("admin.labels.validation.id_missing")),
    tenantId: requiredTrimmedString(
      t("admin.labels.validation.tenant_missing")
    ),
    variantType: requiredTrimmedString(
      t("admin.eye_catch.aspect.variant_type_missing")
    ),
  });
};
const eyeCatchAspectFormFields = {
  crop: { kind: "value", name: CROP_RECT_FIELD },
  publicId: { kind: "value", name: "public_id" },
  tenantId: { kind: "value", name: "tenant_id" },
  variantType: { kind: "value", name: "variant_type" },
} as const;

/**
 * The ratio is echoed back in every result so the slot that submitted is the
 * only one that shows the message — four slots share this Action.
 */
const toAspectFailure = (
  message: string,
  variantType: string
): EyeCatchAspectActionState => ({ message, ok: false, variantType });

export const uploadLabelEyeCatchAspectImageAction = async (
  _prevState: EyeCatchAspectActionState,
  formData: FormData
): Promise<EyeCatchAspectActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    eyeCatchAspectSchema(locale),
  ]);
  const parsed = schema
    .extend({ aspectImage: optionalFileFormSchema })
    .safeParse(
      toFormDataInput(formData, {
        ...eyeCatchAspectFormFields,
        aspectImage: { kind: "file", name: "aspect_image" },
      })
    );
  if (!parsed.success) {
    return toAspectFailure(toFormErrorMessage(parsed.error, { locale }), "");
  }

  const { aspectImage, crop, publicId, tenantId, variantType } = parsed.data;
  if (!aspectImage) {
    return toAspectFailure(
      t("admin.eye_catch.aspect.image_required"),
      variantType
    );
  }

  const imageData = new Uint8Array(await aspectImage.arrayBuffer());
  const result = await withAdminSessionReauth(() =>
    uploadLabelEyeCatchAspectImage(
      {
        crop,
        imageContentType: aspectImage.type || undefined,
        imageData,
        publicId,
        tenantId,
        variantType,
      },
      locale
    )
  );

  if (!result.ok) {
    return "imageRejected" in result
      ? { imageInvalid: true, ok: false, variantType }
      : toAspectFailure(result.message, variantType);
  }

  updateTag(`labels-${tenantId}`);
  updateTag(`label-${tenantId}-${publicId}`);

  return {
    message: t("admin.eye_catch.aspect.uploaded"),
    ok: true,
    variantType,
  };
};
