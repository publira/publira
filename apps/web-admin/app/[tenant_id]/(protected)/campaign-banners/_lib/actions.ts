"use server";

import type { Locale } from "@publira/i18n";
import type * as ActionForm from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { eyeCatchAspectImageInvalidMessage } from "#components/eye-catch/aspects";
import type { EyeCatchAspectActionState } from "#components/eye-catch/types";
import { getActionLocale } from "#lib/action-messages";
import { withAdminSessionReauth } from "#lib/auth-session";
import {
  campaignBannersCacheTag,
  createCampaignBanner,
  deleteCampaignBanner,
  reorderCampaignBanners,
  updateCampaignBanner,
  uploadCampaignBannerAspectImage,
} from "#lib/campaign-banner";
import type { CampaignBannerItem } from "#lib/campaign-banner";
import {
  CAMPAIGN_BANNER_ALT_TEXT_MAX_LENGTH,
  CAMPAIGN_BANNER_LINK_MAX_LENGTH,
  isCampaignBannerLink,
  toCampaignBannerWindow,
} from "#lib/campaign-banner-schedule";
import { CROP_RECT_FIELD } from "#lib/crop-rect";
import { assertSameOrigin } from "#lib/csrf";
import {
  checkboxOnFormSchema,
  jsonRecordIdArrayFormSchema,
  optionalCropRectFormSchema,
  optionalFileFormSchema,
  optionalTrimmedString,
  requiredRecordId,
  requiredTrimmedString,
} from "#lib/form-schemas";
import { getMessagesFor } from "#lib/messages";
import type { AdminMessageAccessor } from "#lib/messages";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import type { CampaignBannerReorderResult } from "../campaign-banner-types";

const tenantIdSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return requiredTrimmedString(
    t("admin.campaign_banners.validation.tenant_missing")
  );
};

const idSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return requiredRecordId(t("admin.campaign_banners.validation.id_missing"));
};

/** The fields a create and an update both post, held to the API's rules. */
const bannerFieldsSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    altText: optionalTrimmedString(
      CAMPAIGN_BANNER_ALT_TEXT_MAX_LENGTH,
      t("admin.campaign_banners.validation.alt_text_too_long")
    ),
    endsAt: optionalTrimmedString(),
    image: optionalFileFormSchema,
    linkUrl: requiredTrimmedString(
      t("admin.campaign_banners.validation.link_required"),
      CAMPAIGN_BANNER_LINK_MAX_LENGTH,
      t("admin.campaign_banners.validation.link_invalid")
    ).refine(
      isCampaignBannerLink,
      t("admin.campaign_banners.validation.link_invalid")
    ),
    published: checkboxOnFormSchema,
    startsAt: optionalTrimmedString(),
    tenantId: await tenantIdSchema(locale),
  });
};

const bannerFormFields = {
  altText: { kind: "value", name: "alt_text" },
  endsAt: { kind: "value", name: "ends_at" },
  image: { kind: "file", name: "eye_catch_image" },
  linkUrl: { kind: "value", name: "link_url" },
  published: "value",
  startsAt: { kind: "value", name: "starts_at" },
  tenantId: { kind: "value", name: "tenant_id" },
} as const;

const rowFormFields = {
  id: { kind: "value", name: "campaign_banner_id" },
  tenantId: { kind: "value", name: "tenant_id" },
} as const;

const toImage = async (file: File | undefined) =>
  file
    ? {
        imageContentType: file.type || undefined,
        imageData: new Uint8Array(await file.arrayBuffer()),
      }
    : { imageContentType: undefined, imageData: undefined };

/**
 * Whether a save that carried a new image came back holding it. The API cuts
 * the upload into the landscape ratio, so an answer without variants, or with
 * the timestamp the form was rendered with, stored something other than what
 * the operator picked — the same check the series, label, and genre cover
 * image forms make before they say the image was saved.
 */
const unconfirmedImageMessage = (
  t: AdminMessageAccessor,
  banner: CampaignBannerItem,
  previousImageUpdatedAt: string
): string | undefined => {
  if (banner.imageVariants.length === 0) {
    return t("admin.campaign_banners.image_variants_missing");
  }

  if (
    previousImageUpdatedAt.length > 0 &&
    banner.imageUpdatedAt === previousImageUpdatedAt
  ) {
    return t("admin.campaign_banners.image_upload_not_reflected");
  }

  return undefined;
};

/**
 * Creates the banner the new screen submitted and opens it. The form posts an
 * image and a link, both of which the API requires: a banner with neither is
 * a band that shows nothing, so it is refused here before it is sent.
 */
export const createCampaignBannerAction = async (
  _prevState: ActionForm.State,
  formData: FormData
): Promise<ActionForm.State> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);

  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    bannerFieldsSchema(locale),
  ]);

  const parsed = schema.safeParse(toFormDataInput(formData, bannerFormFields));

  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const { altText, image, linkUrl, published, tenantId } = parsed.data;

  if (!image) {
    return {
      message: t("admin.campaign_banners.validation.image_required"),
      ok: false,
    };
  }

  const window = await toCampaignBannerWindow(
    parsed.data,
    {
      requireFutureEnd: true,
      timeZone: await getTenantDisplayTimeZone(tenantId),
    },
    locale
  );

  if (!window.ok) {
    return { message: window.message, ok: false };
  }

  const imageData = new Uint8Array(await image.arrayBuffer());

  const result = await withAdminSessionReauth(() =>
    createCampaignBanner(
      {
        altText,
        endsAt: window.endsAt,
        imageContentType: image.type || undefined,
        imageData,
        linkUrl,
        published,
        startsAt: window.startsAt,
        tenantId,
      },
      locale
    )
  );

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(campaignBannersCacheTag(tenantId));

  // The banner exists either way, so staying on this form would only invite a
  // second one. A create whose image cannot be confirmed opens the banner's
  // cover image tab instead, which shows it has none and takes another upload.
  if (unconfirmedImageMessage(t, result.banner, "")) {
    redirect(`/campaign-banners/${result.banner.publicId}?tab=eye-catch`);
  }

  redirect(`/campaign-banners/${result.banner.publicId}?created=1`);
};

/**
 * Saves the banner the edit screen submitted. The details form and the cover
 * image form both post the link, the alternative text, the window, and the
 * published flag, because `UpdateCampaignBanner` replaces them together; only
 * the image form posts a file, which replaces the whole image and which that
 * form cannot go without.
 */
const saveCampaignBanner = async (
  formData: FormData,
  options: { requireImage: boolean }
): Promise<
  | { message: string; ok: false }
  | { banner: CampaignBannerItem; ok: true; t: AdminMessageAccessor }
> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);

  const [t, baseSchema, id] = await Promise.all([
    getMessagesFor(locale),
    bannerFieldsSchema(locale),
    idSchema(locale),
  ]);

  const parsed = baseSchema
    .extend({ currentImageUpdatedAt: optionalTrimmedString(), id })
    .safeParse(
      toFormDataInput(formData, {
        ...bannerFormFields,
        currentImageUpdatedAt: {
          kind: "value",
          name: "current_eye_catch_image_updated_at",
        },
        id: { kind: "value", name: "campaign_banner_id" },
      })
    );

  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const {
    altText,
    currentImageUpdatedAt,
    image,
    linkUrl,
    published,
    tenantId,
  } = parsed.data;

  if (options.requireImage && !image) {
    return {
      message: t("admin.campaign_banners.validation.image_required"),
      ok: false,
    };
  }

  const window = await toCampaignBannerWindow(
    parsed.data,
    {
      requireFutureEnd: false,
      timeZone: await getTenantDisplayTimeZone(tenantId),
    },
    locale
  );

  if (!window.ok) {
    return { message: window.message, ok: false };
  }

  const { imageContentType, imageData } = await toImage(image);

  const result = await withAdminSessionReauth(() =>
    updateCampaignBanner(
      {
        altText,
        endsAt: window.endsAt,
        id: parsed.data.id,
        imageContentType,
        imageData,
        linkUrl,
        published,
        startsAt: window.startsAt,
        tenantId,
      },
      locale
    )
  );

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(campaignBannersCacheTag(tenantId));

  if (imageData) {
    const unconfirmed = unconfirmedImageMessage(
      t,
      result.banner,
      currentImageUpdatedAt
    );

    if (unconfirmed) {
      return { message: unconfirmed, ok: false };
    }
  }

  return { banner: result.banner, ok: true, t };
};

export const updateCampaignBannerAction = async (
  _prevState: ActionForm.State,
  formData: FormData
): Promise<ActionForm.State> => {
  const saved = await saveCampaignBanner(formData, { requireImage: false });

  if (!saved.ok) {
    return saved;
  }

  return { message: saved.t("admin.campaign_banners.updated"), ok: true };
};

export const updateCampaignBannerImageAction = async (
  _prevState: ActionForm.State,
  formData: FormData
): Promise<ActionForm.State> => {
  const saved = await saveCampaignBanner(formData, { requireImage: true });

  if (!saved.ok) {
    return saved;
  }

  return { message: saved.t("admin.campaign_banners.image_updated"), ok: true };
};

export const deleteCampaignBannerAction = async (
  _prevState: ActionForm.State,
  formData: FormData
): Promise<ActionForm.State> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);

  const [t, id, tenantId] = await Promise.all([
    getMessagesFor(locale),
    idSchema(locale),
    tenantIdSchema(locale),
  ]);

  const parsed = z
    .object({ id, tenantId })
    .safeParse(toFormDataInput(formData, rowFormFields));

  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const result = await withAdminSessionReauth(() =>
    deleteCampaignBanner(parsed.data, locale)
  );

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(campaignBannersCacheTag(parsed.data.tenantId));

  return { message: t("admin.campaign_banners.deleted"), ok: true };
};

export const reorderCampaignBannersAction = async (
  formData: FormData
): Promise<CampaignBannerReorderResult> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);

  const [t, tenantId] = await Promise.all([
    getMessagesFor(locale),
    tenantIdSchema(locale),
  ]);

  const parsed = z
    .object({
      expectedIds: jsonRecordIdArrayFormSchema,
      ids: jsonRecordIdArrayFormSchema,
      tenantId,
    })
    .safeParse(
      toFormDataInput(formData, {
        expectedIds: { kind: "value", name: "expected_campaign_banner_ids" },
        ids: { kind: "value", name: "campaign_banner_ids" },
        tenantId: { kind: "value", name: "tenant_id" },
      })
    );

  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, {
        fallback: t("admin.campaign_banners.reorder_failed"),
        locale,
      }),
      ok: false,
    };
  }

  const { expectedIds, ids } = parsed.data;

  if (ids.length === 0 || ids.length !== expectedIds.length) {
    return { message: t("admin.campaign_banners.reorder_failed"), ok: false };
  }

  const result = await withAdminSessionReauth(() =>
    reorderCampaignBanners(parsed.data, locale)
  );

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(campaignBannersCacheTag(parsed.data.tenantId));

  return { ok: true };
};

export const uploadCampaignBannerAspectImageAction = async (
  _prevState: EyeCatchAspectActionState,
  formData: FormData
): Promise<EyeCatchAspectActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);

  const [t, id, tenantId] = await Promise.all([
    getMessagesFor(locale),
    idSchema(locale),
    tenantIdSchema(locale),
  ]);

  const parsed = z
    .object({
      aspectImage: optionalFileFormSchema,
      crop: optionalCropRectFormSchema(t("admin.image_crop.invalid")),
      id,
      tenantId,
      variantType: requiredTrimmedString(
        t("admin.eye_catch.aspect.variant_type_missing")
      ),
    })
    .safeParse(
      toFormDataInput(formData, {
        ...rowFormFields,
        aspectImage: { kind: "file", name: "aspect_image" },
        crop: { kind: "value", name: CROP_RECT_FIELD },
        variantType: { kind: "value", name: "variant_type" },
      })
    );

  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const { aspectImage, crop, variantType } = parsed.data;

  if (!aspectImage) {
    return { message: t("admin.eye_catch.aspect.image_required"), ok: false };
  }

  const imageData = new Uint8Array(await aspectImage.arrayBuffer());

  const result = await withAdminSessionReauth(() =>
    uploadCampaignBannerAspectImage(
      {
        crop,
        id: parsed.data.id,
        imageContentType: aspectImage.type || undefined,
        imageData,
        tenantId: parsed.data.tenantId,
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

  updateTag(campaignBannersCacheTag(parsed.data.tenantId));

  return { message: t("admin.eye_catch.aspect.uploaded"), ok: true };
};
