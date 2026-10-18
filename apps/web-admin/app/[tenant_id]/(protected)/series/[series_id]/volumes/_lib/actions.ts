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
import { assertSameOrigin } from "#lib/csrf";
import {
  flagOneFormSchema,
  jsonRecordIdArrayFormSchema,
  optionalFileFormSchema,
  optionalTrimmedString,
  requiredRecordId,
  requiredTrimmedString,
} from "#lib/form-schemas";
import { getMessagesFor } from "#lib/messages";
import type { AdminMessageAccessor } from "#lib/messages";
import { parseTenantPrice, rawPriceFormSchema } from "#lib/price-action";
import {
  createVolume,
  deleteVolumeCoverImage,
  publishVolume,
  reorderVolumes,
  setVolumeEpisodes,
  updateVolume,
  uploadVolumeCoverImage,
  volumesCacheTag,
} from "#lib/volume";
import type { VolumeItem } from "#lib/volume";

import type { VolumeReorderResult } from "../volume-types";

/** The fields every volume form posts: whose series, and which tenant's. */
const seriesFieldsSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    seriesId: requiredRecordId(
      t("admin.series.volumes.validation.series_missing")
    ),
    tenantId: requiredTrimmedString(
      t("admin.series.volumes.validation.tenant_missing")
    ),
  });
};
const seriesFormFields = {
  seriesId: { kind: "value", name: "series_id" },
  tenantId: { kind: "value", name: "tenant_id" },
} as const;

/** {@link seriesFieldsSchema} and the volume a form on its screen writes. */
const volumeFieldsSchema = async (locale: Locale) => {
  const [t, base] = await Promise.all([
    getMessagesFor(locale),
    seriesFieldsSchema(locale),
  ]);

  return base.extend({
    id: requiredRecordId(t("admin.series.volumes.validation.id_missing")),
  });
};
const volumeFormFields = {
  ...seriesFormFields,
  id: { kind: "value", name: "volume_id" },
} as const;

/** The title and the price a create and an update both post. */
const detailsFieldsSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    price: rawPriceFormSchema,
    priceCurrency: optionalTrimmedString(),
    title: requiredTrimmedString(
      t("admin.series.volumes.validation.title_required"),
      255,
      t("admin.series.volumes.validation.title_invalid")
    ),
  });
};
const detailsFormFields = {
  price: "value",
  priceCurrency: { kind: "value", name: "price_currency" },
  title: "value",
} as const;

/**
 * The price a details form posted, read in the tenant's currency. A volume is
 * never free, which the API refuses too: an episode that should cost nothing
 * is made free itself.
 */
const parseVolumePrice = async (
  input: { price: string; priceCurrency: string; tenantId: string },
  locale: Locale
): Promise<
  { currency: string; ok: true; value: number } | { message: string; ok: false }
> => {
  const parsed = await parseTenantPrice(
    input.price,
    input.priceCurrency,
    input.tenantId,
    locale
  );
  if (!parsed.ok) {
    return parsed;
  }
  if (parsed.value <= 0) {
    const t = await getMessagesFor(locale);
    return {
      message: t("admin.series.volumes.validation.price_invalid"),
      ok: false,
    };
  }
  return parsed;
};

/**
 * Creates the volume the Volumes tab submitted and opens it, since a new
 * volume holds no episodes and the next thing the editor does is give it some.
 */
export const createVolumeAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, base, details] = await Promise.all([
    getMessagesFor(locale),
    seriesFieldsSchema(locale),
    detailsFieldsSchema(locale),
  ]);
  const parsed = base
    .extend({
      ...details.shape,
      seriesPublicId: requiredTrimmedString(
        t("admin.series.volumes.validation.series_missing")
      ),
    })
    .safeParse(
      toFormDataInput(formData, {
        ...seriesFormFields,
        ...detailsFormFields,
        seriesPublicId: { kind: "value", name: "series_public_id" },
      })
    );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const { seriesId, seriesPublicId, tenantId, title } = parsed.data;
  const price = await parseVolumePrice(parsed.data, locale);
  if (!price.ok) {
    return { message: price.message, ok: false };
  }

  const result = await withAdminSessionReauth(() =>
    createVolume(
      {
        currency: price.currency,
        price: price.value,
        seriesId,
        tenantId,
        title,
      },
      locale
    )
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(volumesCacheTag(tenantId, seriesId));

  redirect(
    `/series/${seriesPublicId}/volumes/${result.volume.publicId}?created=1`
  );
};

export const updateVolumeAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, base, details] = await Promise.all([
    getMessagesFor(locale),
    volumeFieldsSchema(locale),
    detailsFieldsSchema(locale),
  ]);
  const parsed = base.extend(details.shape).safeParse(
    toFormDataInput(formData, {
      ...volumeFormFields,
      ...detailsFormFields,
    })
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const { id, seriesId, tenantId, title } = parsed.data;
  const price = await parseVolumePrice(parsed.data, locale);
  if (!price.ok) {
    return { message: price.message, ok: false };
  }

  const result = await withAdminSessionReauth(() =>
    updateVolume(
      { currency: price.currency, id, price: price.value, tenantId, title },
      locale
    )
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(volumesCacheTag(tenantId, seriesId));

  return { message: t("admin.series.volumes.updated"), ok: true };
};

/** Puts the volume on sale when `published` is `"1"`, and takes it off otherwise. */
export const publishVolumeAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, base] = await Promise.all([
    getMessagesFor(locale),
    volumeFieldsSchema(locale),
  ]);
  const parsed = base.extend({ published: flagOneFormSchema }).safeParse(
    toFormDataInput(formData, {
      ...volumeFormFields,
      published: "value",
    })
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const { id, published, seriesId, tenantId } = parsed.data;
  const result = await withAdminSessionReauth(() =>
    publishVolume({ id, published, tenantId }, locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(volumesCacheTag(tenantId, seriesId));

  return {
    message: result.volume.published
      ? t("admin.series.volumes.sale.published")
      : t("admin.series.volumes.sale.unpublished"),
    ok: true,
  };
};

/**
 * Replaces the episodes the volume holds with the list the editor arranged.
 * The list is posted whole, in its order, because `SetVolumeEpisodes` takes it
 * that way; an emptied list is sent as well, and the API refuses it for a
 * volume that has been on sale.
 */
export const setVolumeEpisodesAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, base] = await Promise.all([
    getMessagesFor(locale),
    volumeFieldsSchema(locale),
  ]);
  const parsed = base
    .extend({ episodeIds: jsonRecordIdArrayFormSchema })
    .safeParse(
      toFormDataInput(formData, {
        ...volumeFormFields,
        episodeIds: { kind: "value", name: "episode_ids" },
      })
    );
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, {
        fallback: t("admin.series.volumes.episodes.save_failed"),
        locale,
      }),
      ok: false,
    };
  }

  const { episodeIds, id, seriesId, tenantId } = parsed.data;
  if (new Set(episodeIds).size !== episodeIds.length) {
    return { message: t("admin.series.volumes.episodes.invalid"), ok: false };
  }

  const result = await withAdminSessionReauth(() =>
    setVolumeEpisodes({ episodeIds, id, tenantId }, locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(volumesCacheTag(tenantId, seriesId));

  return { message: t("admin.series.volumes.episodes.saved"), ok: true };
};

export const reorderVolumesAction = async (
  formData: FormData
): Promise<VolumeReorderResult> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, base] = await Promise.all([
    getMessagesFor(locale),
    seriesFieldsSchema(locale),
  ]);
  const parsed = base
    .extend({
      expectedIds: jsonRecordIdArrayFormSchema,
      ids: jsonRecordIdArrayFormSchema,
    })
    .safeParse(
      toFormDataInput(formData, {
        ...seriesFormFields,
        expectedIds: { kind: "value", name: "expected_volume_ids" },
        ids: { kind: "value", name: "volume_ids" },
      })
    );
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, {
        fallback: t("admin.series.volumes.reorder_failed"),
        locale,
      }),
      ok: false,
    };
  }

  const { expectedIds, ids } = parsed.data;
  if (ids.length === 0 || ids.length !== expectedIds.length) {
    return { message: t("admin.series.volumes.reorder_failed"), ok: false };
  }

  const result = await withAdminSessionReauth(() =>
    reorderVolumes(parsed.data, locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(volumesCacheTag(parsed.data.tenantId, parsed.data.seriesId));

  return { ok: true };
};

/**
 * Whether an upload came back holding the image it carried. The API cuts the
 * upload into every ratio, so an answer without variants, or with the
 * timestamp the form was rendered with, stored something other than what the
 * editor picked — the check the series cover image form makes too.
 */
const unconfirmedCoverMessage = (
  t: AdminMessageAccessor,
  volume: VolumeItem,
  previousCoverImageUpdatedAt: string
): string | undefined => {
  if (volume.coverImageVariants.length === 0) {
    return t("admin.series.volumes.cover.variants_missing");
  }
  if (
    previousCoverImageUpdatedAt.length > 0 &&
    volume.coverImageUpdatedAt === previousCoverImageUpdatedAt
  ) {
    return t("admin.series.volumes.cover.upload_not_reflected");
  }
  return undefined;
};

/**
 * Replaces the volume's cover with the image the form picked, or removes it
 * when the form's delete toggle was set.
 */
export const updateVolumeCoverAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, base] = await Promise.all([
    getMessagesFor(locale),
    volumeFieldsSchema(locale),
  ]);
  const parsed = base
    .extend({
      clearCoverImage: flagOneFormSchema,
      coverImage: optionalFileFormSchema,
      currentCoverImageUpdatedAt: optionalTrimmedString(),
    })
    .safeParse(
      toFormDataInput(formData, {
        ...volumeFormFields,
        clearCoverImage: { kind: "value", name: "clear_eye_catch_image" },
        coverImage: { kind: "file", name: "eye_catch_image" },
        currentCoverImageUpdatedAt: {
          kind: "value",
          name: "current_eye_catch_image_updated_at",
        },
      })
    );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const {
    clearCoverImage,
    coverImage,
    currentCoverImageUpdatedAt,
    id,
    seriesId,
    tenantId,
  } = parsed.data;

  if (clearCoverImage) {
    const result = await withAdminSessionReauth(() =>
      deleteVolumeCoverImage({ id, tenantId }, locale)
    );
    if (!result.ok) {
      return { message: result.message, ok: false };
    }

    updateTag(volumesCacheTag(tenantId, seriesId));

    return { message: t("admin.series.volumes.cover.deleted"), ok: true };
  }

  if (!coverImage) {
    return {
      message: t("admin.series.volumes.cover.choice_required"),
      ok: false,
    };
  }

  const imageData = new Uint8Array(await coverImage.arrayBuffer());
  const result = await withAdminSessionReauth(() =>
    uploadVolumeCoverImage(
      {
        id,
        imageContentType: coverImage.type || undefined,
        imageData,
        tenantId,
      },
      locale
    )
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(volumesCacheTag(tenantId, seriesId));

  const unconfirmed = unconfirmedCoverMessage(
    t,
    result.volume,
    currentCoverImageUpdatedAt
  );
  if (unconfirmed) {
    return { message: unconfirmed, ok: false };
  }

  return { message: t("admin.series.volumes.cover.updated"), ok: true };
};
