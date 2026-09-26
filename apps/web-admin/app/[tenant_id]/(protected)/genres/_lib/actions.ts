"use server";

import type { Locale } from "@publira/i18n";
import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { z } from "zod";

import type { EyeCatchAspectActionState } from "#components/eye-catch/types";
import { getActionLocale } from "#lib/action-messages";
import { withAdminSessionReauth } from "#lib/auth-session";
import { CATALOG_NAME_MAX_LENGTH } from "#lib/catalog-name";
import { CROP_RECT_FIELD } from "#lib/crop-rect";
import { assertSameOrigin } from "#lib/csrf";
import {
  flagOneFormSchema,
  jsonStringArrayFormSchema,
  optionalCropRectFormSchema,
  optionalFileFormSchema,
  optionalTrimmedString,
  requiredTrimmedString,
} from "#lib/form-schemas";
import {
  createGenre,
  deleteGenre,
  genresCacheTag,
  reorderGenres,
  updateGenre,
  uploadGenreEyeCatchAspectImage,
} from "#lib/genre";
import { getMessagesFor } from "#lib/messages";

import type { GenreReorderResult, GenreRowActionState } from "../genre-types";

const nameSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return requiredTrimmedString(
    t("admin.genres.validation.name_required"),
    CATALOG_NAME_MAX_LENGTH,
    t("admin.genres.validation.name_too_long", {
      count: String(CATALOG_NAME_MAX_LENGTH),
    })
  );
};
const tenantIdSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return requiredTrimmedString(t("admin.genres.validation.tenant_missing"));
};
const publicIdSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return requiredTrimmedString(t("admin.genres.validation.id_missing"));
};
const createGenreSchema = async (locale: Locale) =>
  z.object({
    name: await nameSchema(locale),
    tenantId: await tenantIdSchema(locale),
  });
const renameGenreSchema = async (locale: Locale) =>
  z.object({
    name: await nameSchema(locale),
    publicId: await publicIdSchema(locale),
    tenantId: await tenantIdSchema(locale),
  });
const deleteGenreSchema = async (locale: Locale) =>
  z.object({
    publicId: await publicIdSchema(locale),
    tenantId: await tenantIdSchema(locale),
  });
const genreEyeCatchSchema = async (locale: Locale) =>
  z.object({
    clearEyeCatchImage: flagOneFormSchema,
    currentEyeCatchImageUpdatedAt: optionalTrimmedString(),
    eyeCatchImage: optionalFileFormSchema,
    name: await nameSchema(locale),
    publicId: await publicIdSchema(locale),
    tenantId: await tenantIdSchema(locale),
  });
const genreEyeCatchAspectSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    aspectImage: optionalFileFormSchema,
    crop: optionalCropRectFormSchema(t("admin.image_crop.invalid")),
    publicId: await publicIdSchema(locale),
    tenantId: await tenantIdSchema(locale),
    variantType: requiredTrimmedString(
      t("admin.eye_catch.aspect.variant_type_missing")
    ),
  });
};
const reorderGenresSchema = async (locale: Locale) =>
  z.object({
    expectedPublicIds: jsonStringArrayFormSchema,
    publicIds: jsonStringArrayFormSchema,
    tenantId: await tenantIdSchema(locale),
  });
const rowFormFields = {
  publicId: { kind: "value", name: "public_id" },
  tenantId: { kind: "value", name: "tenant_id" },
} as const;

export const createGenreAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    createGenreSchema(locale),
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
    createGenre({ name, tenantId }, locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(genresCacheTag(tenantId));

  return { message: t("admin.genres.created"), ok: true };
};

export const renameGenreAction = async (
  _prevState: GenreRowActionState,
  formData: FormData
): Promise<GenreRowActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    renameGenreSchema(locale),
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
    updateGenre({ name, publicId, tenantId }, locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false, publicId };
  }

  updateTag(genresCacheTag(tenantId));

  return {
    message: t("admin.genres.updated"),
    ok: true,
    publicId,
  };
};

export const deleteGenreAction = async (
  _prevState: GenreRowActionState,
  formData: FormData
): Promise<GenreRowActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    deleteGenreSchema(locale),
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
    deleteGenre({ publicId, tenantId }, locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false, publicId };
  }

  updateTag(genresCacheTag(tenantId));

  return {
    message: t("admin.genres.deleted"),
    ok: true,
    publicId,
  };
};

export const reorderGenresAction = async (
  formData: FormData
): Promise<GenreReorderResult> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    reorderGenresSchema(locale),
  ]);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      expectedPublicIds: {
        kind: "value",
        name: "expected_genre_public_ids",
      },
      publicIds: { kind: "value", name: "genre_public_ids" },
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, {
        fallback: t("admin.genres.reorder_failed"),
        locale,
      }),
      ok: false,
    };
  }

  const { expectedPublicIds, publicIds, tenantId } = parsed.data;
  if (publicIds.length === 0 || publicIds.length !== expectedPublicIds.length) {
    return {
      message: t("admin.genres.reorder_failed"),
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    reorderGenres({ expectedPublicIds, publicIds, tenantId }, locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(genresCacheTag(tenantId));

  return { ok: true };
};

/**
 * Saves the eye-catch the genre screen submitted: a new image for every ratio,
 * or the removal of the one the genre has. `UpdateGenre` takes the name
 * alongside, so the form posts back the name it read.
 */
export const updateGenreEyeCatchAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    genreEyeCatchSchema(locale),
  ]);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      ...rowFormFields,
      clearEyeCatchImage: { kind: "value", name: "clear_eye_catch_image" },
      currentEyeCatchImageUpdatedAt: {
        kind: "value",
        name: "current_eye_catch_image_updated_at",
      },
      eyeCatchImage: { kind: "file", name: "eye_catch_image" },
      name: "value",
    })
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const {
    clearEyeCatchImage,
    currentEyeCatchImageUpdatedAt,
    eyeCatchImage,
    name,
    publicId,
    tenantId,
  } = parsed.data;
  const eyeCatchImageData = eyeCatchImage
    ? new Uint8Array(await eyeCatchImage.arrayBuffer())
    : undefined;

  const result = await withAdminSessionReauth(() =>
    updateGenre(
      {
        clearEyeCatchImage,
        eyeCatchImageContentType: eyeCatchImage?.type || undefined,
        eyeCatchImageData,
        name,
        publicId,
        tenantId,
      },
      locale
    )
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  if (
    eyeCatchImageData &&
    !clearEyeCatchImage &&
    result.genre.eyeCatchImageVariants.length === 0
  ) {
    return {
      message: t("admin.genres.eye_catch_variants_missing"),
      ok: false,
    };
  }

  if (
    eyeCatchImageData &&
    !clearEyeCatchImage &&
    currentEyeCatchImageUpdatedAt.length > 0 &&
    result.genre.eyeCatchImageUpdatedAt === currentEyeCatchImageUpdatedAt
  ) {
    return {
      message: t("admin.genres.eye_catch_upload_not_reflected"),
      ok: false,
    };
  }

  updateTag(genresCacheTag(tenantId));

  return { message: t("admin.genres.eye_catch_updated"), ok: true };
};

/**
 * The ratio is echoed back in every result so the slot that submitted is the
 * only one that shows the message — four slots share this Action.
 */
export const uploadGenreEyeCatchAspectImageAction = async (
  _prevState: EyeCatchAspectActionState,
  formData: FormData
): Promise<EyeCatchAspectActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    genreEyeCatchAspectSchema(locale),
  ]);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      ...rowFormFields,
      aspectImage: { kind: "file", name: "aspect_image" },
      crop: { kind: "value", name: CROP_RECT_FIELD },
      variantType: { kind: "value", name: "variant_type" },
    })
  );
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, { locale }),
      ok: false,
      variantType: "",
    };
  }

  const { aspectImage, crop, publicId, tenantId, variantType } = parsed.data;
  if (!aspectImage) {
    return {
      message: t("admin.eye_catch.aspect.image_required"),
      ok: false,
      variantType,
    };
  }

  const imageData = new Uint8Array(await aspectImage.arrayBuffer());
  const result = await withAdminSessionReauth(() =>
    uploadGenreEyeCatchAspectImage(
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
      : { message: result.message, ok: false, variantType };
  }

  updateTag(genresCacheTag(tenantId));

  return {
    message: t("admin.eye_catch.aspect.uploaded"),
    ok: true,
    variantType,
  };
};
