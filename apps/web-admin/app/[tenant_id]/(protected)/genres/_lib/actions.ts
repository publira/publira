"use server";

import { getLocales, parseLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { z } from "zod";

import { eyeCatchAspectImageInvalidMessage } from "#components/eye-catch/aspects";
import type { EyeCatchAspectActionState } from "#components/eye-catch/types";
import { getActionLocale } from "#lib/action-messages";
import { withAdminSessionReauth } from "#lib/auth-session";
import { CATALOG_NAME_MAX_LENGTH } from "#lib/catalog-name";
import { CROP_RECT_FIELD } from "#lib/crop-rect";
import { assertSameOrigin } from "#lib/csrf";
import {
  flagOneFormSchema,
  jsonRecordIdArrayFormSchema,
  optionalCropRectFormSchema,
  optionalFileFormSchema,
  optionalTrimmedString,
  requiredRecordId,
  requiredTrimmedString,
} from "#lib/form-schemas";
import {
  createGenre,
  deleteGenre,
  genresCacheTag,
  reorderGenres,
  saveGenreNames,
  updateGenre,
  uploadGenreEyeCatchAspectImage,
} from "#lib/genre";
import { getMessagesFor } from "#lib/messages";

import type { GenreReorderResult } from "../genre-types";
import {
  DEFAULT_LOCALE_FIELD,
  nameField,
  savedNameField,
} from "./genre-name-fields";

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
const idSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return requiredRecordId(t("admin.genres.validation.id_missing"));
};
const optionalNameSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return optionalTrimmedString(
    CATALOG_NAME_MAX_LENGTH,
    t("admin.genres.validation.name_too_long", {
      count: String(CATALOG_NAME_MAX_LENGTH),
    })
  );
};
const createGenreSchema = async (locale: Locale) =>
  z.object({
    tenantId: await tenantIdSchema(locale),
  });

/** One language's field of a genre form, as the form posted it. */
interface PostedGenreName {
  /** Absent for the one field a form without languages posts. */
  translationLocale: Locale | undefined;
  name: string;
  /** What the field held when the form was drawn; empty for a new name. */
  savedName: string;
}

/**
 * The names a genre form posted. A form that knows the site's languages posts
 * a field per language and names the default one, whose name is required and
 * comes first; the others may be left empty. A form that does not posts one
 * field in the default language, as the list's rows do.
 */
const parseGenreNames = async (
  formData: FormData,
  locale: Locale
): Promise<
  { ok: true; names: PostedGenreName[] } | { ok: false; message: string }
> => {
  const read = (name: string): string => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  const defaultLocale = parseLocale(read(DEFAULT_LOCALE_FIELD));
  const fields: { translationLocale: Locale | undefined; required: boolean }[] =
    defaultLocale
      ? [
          { required: true, translationLocale: defaultLocale },
          ...getLocales().flatMap((code) =>
            code !== defaultLocale && formData.has(nameField(code))
              ? [{ required: false, translationLocale: code }]
              : []
          ),
        ]
      : [{ required: true, translationLocale: undefined }];
  const [requiredName, optionalName] = await Promise.all([
    nameSchema(locale),
    optionalNameSchema(locale),
  ]);
  const savedNameSchema = optionalTrimmedString();

  const names: PostedGenreName[] = [];
  for (const { required, translationLocale } of fields) {
    const parsed = (required ? requiredName : optionalName).safeParse(
      read(nameField(translationLocale))
    );
    if (!parsed.success) {
      return {
        message: toFormErrorMessage(parsed.error, { locale }),
        ok: false,
      };
    }
    names.push({
      name: parsed.data,
      // Only compared with what was typed, so one that does not parse is
      // treated as no saved name, which writes the name again.
      savedName:
        savedNameSchema.safeParse(read(savedNameField(translationLocale)))
          .data ?? "",
      translationLocale,
    });
  }

  return { names, ok: true };
};
/** The genre a rename or a delete addresses. */
const genreRowSchema = async (locale: Locale) =>
  z.object({
    id: await idSchema(locale),
    tenantId: await tenantIdSchema(locale),
  });
const genreEyeCatchSchema = async (locale: Locale) =>
  z.object({
    clearEyeCatchImage: flagOneFormSchema,
    currentEyeCatchImageUpdatedAt: optionalTrimmedString(),
    eyeCatchImage: optionalFileFormSchema,
    id: await idSchema(locale),
    tenantId: await tenantIdSchema(locale),
  });
const genreEyeCatchAspectSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    aspectImage: optionalFileFormSchema,
    crop: optionalCropRectFormSchema(t("admin.image_crop.invalid")),
    id: await idSchema(locale),
    tenantId: await tenantIdSchema(locale),
    variantType: requiredTrimmedString(
      t("admin.eye_catch.aspect.variant_type_missing")
    ),
  });
};
const reorderGenresSchema = async (locale: Locale) =>
  z.object({
    expectedIds: jsonRecordIdArrayFormSchema,
    ids: jsonRecordIdArrayFormSchema,
    tenantId: await tenantIdSchema(locale),
  });
const rowFormFields = {
  id: { kind: "value", name: "genre_id" },
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
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }
  const posted = await parseGenreNames(formData, locale);
  if (!posted.ok) {
    return posted;
  }

  const { tenantId } = parsed.data;
  // The first name is the default language's, which creates the genre; the
  // others are added to it.
  const [first, ...others] = posted.names;
  const created = await withAdminSessionReauth(() =>
    createGenre(
      {
        name: first.name,
        tenantId,
        translationLocale: first.translationLocale,
      },
      locale
    )
  );
  if (!created.ok) {
    return { message: created.message, ok: false };
  }

  updateTag(genresCacheTag(tenantId));

  const result = await withAdminSessionReauth(() =>
    saveGenreNames(
      {
        id: created.genre.id,
        names: others.flatMap(({ name, translationLocale }) =>
          name === "" ? [] : [{ name, translationLocale }]
        ),
        removedLocales: [],
        tenantId,
      },
      locale
    )
  );
  if (!result.ok) {
    // The genre exists, so creating it again would only be refused as taken.
    return {
      message: t("admin.genres.created_names_failed", {
        reason: result.message,
      }),
      ok: false,
    };
  }

  return { message: t("admin.genres.created"), ok: true };
};

export const renameGenreAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    genreRowSchema(locale),
  ]);
  const parsed = schema.safeParse(toFormDataInput(formData, rowFormFields));
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }
  const posted = await parseGenreNames(formData, locale);
  if (!posted.ok) {
    return posted;
  }

  const { id, tenantId } = parsed.data;
  // A name left as it was is not written again, so a save records only the
  // languages it changed.
  const names = posted.names.flatMap(
    ({ name, savedName, translationLocale }) =>
      name === "" || name === savedName ? [] : [{ name, translationLocale }]
  );
  const removedLocales = posted.names.flatMap(
    ({ name, savedName, translationLocale }) =>
      name === "" && savedName !== "" && translationLocale
        ? [translationLocale]
        : []
  );
  // The names are written one request at a time, so a save that stops part
  // way — refused, or thrown by an error the Action passes on — may already
  // have written the ones before it. The list is cleared however it ends.
  let result: Awaited<ReturnType<typeof saveGenreNames>>;
  try {
    result = await withAdminSessionReauth(() =>
      saveGenreNames({ id, names, removedLocales, tenantId }, locale)
    );
  } finally {
    updateTag(genresCacheTag(tenantId));
  }
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  return {
    message: t("admin.genres.updated"),
    ok: true,
  };
};

export const deleteGenreAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    genreRowSchema(locale),
  ]);
  const parsed = schema.safeParse(toFormDataInput(formData, rowFormFields));
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const { id, tenantId } = parsed.data;
  const result = await withAdminSessionReauth(() =>
    deleteGenre({ id, tenantId }, locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(genresCacheTag(tenantId));

  return {
    message: t("admin.genres.deleted"),
    ok: true,
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
      expectedIds: {
        kind: "value",
        name: "expected_genre_ids",
      },
      ids: { kind: "value", name: "genre_ids" },
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

  const { expectedIds, ids, tenantId } = parsed.data;
  if (ids.length === 0 || ids.length !== expectedIds.length) {
    return {
      message: t("admin.genres.reorder_failed"),
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    reorderGenres({ expectedIds, ids, tenantId }, locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(genresCacheTag(tenantId));

  return { ok: true };
};

/**
 * Saves the eye-catch the genre screen submitted: a new image for every ratio,
 * or the removal of the one the genre has. It sends no name, which leaves
 * every name the genre has as it is.
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
    })
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const {
    clearEyeCatchImage,
    currentEyeCatchImageUpdatedAt,
    eyeCatchImage,
    id,
    tenantId,
  } = parsed.data;
  const eyeCatchImageData = eyeCatchImage
    ? new Uint8Array(await eyeCatchImage.arrayBuffer())
    : undefined;
  // `UpdateGenre` without a name needs an eye-catch change to save, and a
  // form submitted with neither has nothing to save.
  if (!(eyeCatchImageData || clearEyeCatchImage)) {
    return { message: t("admin.genres.eye_catch_updated"), ok: true };
  }

  const result = await withAdminSessionReauth(() =>
    updateGenre(
      {
        clearEyeCatchImage,
        eyeCatchImageContentType: eyeCatchImage?.type || undefined,
        eyeCatchImageData,
        id,
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
    };
  }

  const { aspectImage, crop, id, tenantId, variantType } = parsed.data;
  if (!aspectImage) {
    return {
      message: t("admin.eye_catch.aspect.image_required"),
      ok: false,
    };
  }

  const imageData = new Uint8Array(await aspectImage.arrayBuffer());
  const result = await withAdminSessionReauth(() =>
    uploadGenreEyeCatchAspectImage(
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
    return {
      message:
        "imageRejected" in result
          ? eyeCatchAspectImageInvalidMessage(t, variantType)
          : result.message,
      ok: false,
    };
  }

  updateTag(genresCacheTag(tenantId));

  return {
    message: t("admin.eye_catch.aspect.uploaded"),
    ok: true,
  };
};
