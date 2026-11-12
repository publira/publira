"use server";

import type { Locale } from "@publira/i18n";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { eyeCatchAspectImageInvalidMessage } from "#components/eye-catch/aspects";
import type { EyeCatchAspectActionState } from "#components/eye-catch/types";
import { getActionLocale } from "#lib/action-messages";
import { verifyAdminSession, withAdminSessionReauth } from "#lib/auth-session";
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
import {
  createLabel,
  deleteLabel,
  getLabelForTenant,
  updateLabel,
  uploadLabelEyeCatchAspectImage,
} from "#lib/label";
import { getMessagesFor } from "#lib/messages";
import type { AdminMessageAccessor } from "#lib/messages";
import { promotionCodesCacheTag } from "#lib/promotion-code";
import { seriesListCacheTag } from "#lib/series";

import type {
  LabelActionState,
  LabelDeleteActionState,
  LabelListItem,
  LabelMutationMode,
} from "../label-types";

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
    id: requiredRecordId(t("admin.labels.validation.id_missing")),
  });
};

const labelFormFields = {
  eyeCatchImage: { kind: "file", name: "eye_catch_image" },
  name: "value",
  tenantId: { kind: "value", name: "tenant_id" },
} as const;

type LabelActionFailure = Extract<LabelActionState, { ok: false }>;

const toFailure = (
  message: string,
  mode: LabelMutationMode
): LabelActionFailure => ({
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

/**
 * Saves the label the edit screen submitted. The name form and the eye-catch
 * form both post every field, so they share this and differ only in the
 * confirmation each gives.
 */
const saveLabel = async (
  formData: FormData
): Promise<
  | LabelActionFailure
  | { label: LabelListItem; ok: true; t: AdminMessageAccessor }
> => {
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
      id: { kind: "value", name: "label_id" },
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
    id,
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
        id,
        name,
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
  updateTag(`label-${tenantId}-${result.label.publicId}`);
  // `/series` names each row's label, so a rename has to reach that list too.
  updateTag(seriesListCacheTag(tenantId));

  return { label: result.label, ok: true, t };
};

export const updateLabelAction = async (
  _prevState: LabelActionState,
  formData: FormData
): Promise<LabelActionState> => {
  const saved = await saveLabel(formData);

  if (!saved.ok) {
    return saved;
  }

  return {
    message: saved.t("admin.labels.updated"),
    mode: "update",
    ok: true,
  };
};

export const updateLabelEyeCatchAction = async (
  _prevState: LabelActionState,
  formData: FormData
): Promise<LabelActionState> => {
  const saved = await saveLabel(formData);

  if (!saved.ok) {
    return saved;
  }

  return {
    message: saved.t("admin.labels.eye_catch_updated"),
    mode: "update",
    ok: true,
  };
};

const deleteLabelSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    id: requiredRecordId(t("admin.labels.validation.id_missing")),
    // Compared as it was typed, as the dialog compares it.
    nameConfirmation: z.string().catch(""),
    publicId: requiredTrimmedString(t("admin.labels.validation.id_missing")),
    tenantId: requiredTrimmedString(
      t("admin.labels.validation.tenant_missing")
    ),
  });
};

/**
 * Deletes the label once the name typed into the dialog is the one it has,
 * then leaves for the label list. The list names the label in its toast from
 * the query string, since no label is left to read it from.
 */
export const deleteLabelAction = async (
  _prevState: LabelDeleteActionState,
  formData: FormData
): Promise<LabelDeleteActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const schema = await deleteLabelSchema(locale);

  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      id: { kind: "value", name: "label_id" },
      nameConfirmation: { kind: "value", name: "name_confirmation" },
      publicId: { kind: "value", name: "label_public_id" },
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );

  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const { id, nameConfirmation, publicId, tenantId } = parsed.data;
  await verifyAdminSession(tenantId);

  const [t, target] = await Promise.all([
    getMessagesFor(locale),
    getLabelForTenant({ publicId, tenantId }, locale),
  ]);

  if (!target.ok) {
    return {
      message: target.notFound
        ? t("admin.labels.delete.not_found")
        : target.message,
      ok: false,
    };
  }

  if (target.label.id !== id) {
    return { message: t("admin.labels.validation.id_missing"), ok: false };
  }

  const { name } = target.label;

  if (nameConfirmation !== name) {
    return { message: t("admin.labels.delete.name_mismatch"), ok: false };
  }

  const result = await withAdminSessionReauth(() =>
    deleteLabel({ id, tenantId }, locale)
  );

  if (!result.ok) {
    return { message: result.message, ok: false, reference: result.reference };
  }

  updateTag(`labels-${tenantId}`);
  updateTag(`label-${tenantId}-${publicId}`);
  // The promotion codes for the label that were deleted before anyone redeemed
  // them went with it.
  updateTag(promotionCodesCacheTag(tenantId));

  redirect(
    `/labels?${new URLSearchParams({ deleted: "1", deleted_name: name }).toString()}`
  );
};

const eyeCatchAspectSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    crop: optionalCropRectFormSchema(t("admin.image_crop.invalid")),
    id: requiredRecordId(t("admin.labels.validation.id_missing")),
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
  id: { kind: "value", name: "label_id" },
  tenantId: { kind: "value", name: "tenant_id" },
  variantType: { kind: "value", name: "variant_type" },
} as const;

const toAspectFailure = (message: string): EyeCatchAspectActionState => ({
  message,
  ok: false,
});

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
    return toAspectFailure(toFormErrorMessage(parsed.error, { locale }));
  }

  const { aspectImage, crop, id, tenantId, variantType } = parsed.data;

  if (!aspectImage) {
    return toAspectFailure(t("admin.eye_catch.aspect.image_required"));
  }

  const imageData = new Uint8Array(await aspectImage.arrayBuffer());

  const result = await withAdminSessionReauth(() =>
    uploadLabelEyeCatchAspectImage(
      {
        crop,
        id,
        imageContentType: aspectImage.type || undefined,
        imageData,
        tenantId,
        variantType,
      },
      locale
    )
  );

  if (!result.ok) {
    return toAspectFailure(
      "imageRejected" in result
        ? eyeCatchAspectImageInvalidMessage(t, variantType)
        : result.message
    );
  }

  updateTag(`labels-${tenantId}`);
  updateTag(`label-${tenantId}-${result.label.publicId}`);

  return {
    message: t("admin.eye_catch.aspect.uploaded"),
    ok: true,
  };
};
