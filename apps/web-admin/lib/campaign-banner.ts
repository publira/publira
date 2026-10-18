import type { AdminCampaignBanner } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import type { RpcErrorMessageOverrides } from "@publira/api-client/error-messages";
import {
  RPC_ERROR_REASON,
  rethrowUnclassifiedRpcError,
  rpcErrorDisposition,
  rpcErrorHasFieldViolation,
  rpcErrorHasReason,
} from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheTag } from "next/cache";

import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import type { CachedRead } from "./cached-read";
import { settleCachedRead } from "./cached-read";
import type { CropRect } from "./crop-rect";
import {
  mentionsAspectImageRejection,
  mentionsStorageNotConfigured,
} from "./image-rejection";
import { getMessagesFor } from "./messages";
import { getAccessToken } from "./session";

export interface CampaignBannerItem {
  /** The primary key every banner write addresses the banner by. */
  id: string;
  /** What the banner's edit screen is addressed by in the URL. */
  publicId: string;
  /** A path on the tenant's own site or an absolute http(s) URL. */
  linkUrl: string;
  /** The half-open display window, as the instants the API answers. */
  startsAt: string;
  endsAt: string;
  published: boolean;
  imageUpdatedAt: string;
  imageVariants: {
    variantType: string;
    label: string;
    url: string;
    contentType: string;
    width: number;
    height: number;
    fileSizeBytes: number;
  }[];
}

export type ListCampaignBannersResult =
  | { ok: true; banners: CampaignBannerItem[] }
  | {
      ok: false;
      message: string;
      banners: CampaignBannerItem[];
      /** The API rejected the session — the page raises the login redirect. */
      requiresSignIn: boolean;
    };

/**
 * `notFound: true` is the "there is nothing to show here" failure the edit
 * screen turns into `notFound()`, carrying no message for the same reason
 * `GetGenreResult` carries none.
 */
export type GetCampaignBannerResult =
  | { ok: true; banner: CampaignBannerItem }
  | { notFound: true; ok: false }
  | {
      message: string;
      notFound?: false;
      ok: false;
      /** The API rejected the session — the page raises the login redirect. */
      requiresSignIn: boolean;
    };

export type SaveCampaignBannerResult =
  | { ok: true; banner: CampaignBannerItem }
  | { ok: false; message: string };

export type CampaignBannerAspectResult =
  | { ok: true; banner: CampaignBannerItem }
  /** The API refused the image itself; the slot that submitted words it. */
  | { ok: false; imageRejected: true }
  | { ok: false; message: string };

export type ReorderCampaignBannersResult =
  | { ok: true }
  | { ok: false; message: string };

export type DeleteCampaignBannerResult =
  | { ok: true }
  | { ok: false; message: string };

/** The tag every banner read is filed under, and every banner write drops. */
export const campaignBannersCacheTag = (tenantId: string): string =>
  `campaign-banners-${tenantId}`;

/**
 * The rules the API holds a create and an update to. `invalid-argument` names
 * the field it refused, so each of the image, the link, and the window gets
 * the wording that tells the operator what to change; `precondition` is
 * either the tenant's banner limit or an object store nobody has saved yet.
 */
const saveOverrides = async (
  error: unknown,
  locale: Locale
): Promise<RpcErrorMessageOverrides> => {
  const t = await getMessagesFor(locale);
  const invalidArgument = (): string => {
    if (
      rpcErrorHasFieldViolation(error, "image_data") ||
      rpcErrorHasFieldViolation(error, "image_content_type")
    ) {
      return t("admin.campaign_banners.image_invalid");
    }
    if (rpcErrorHasFieldViolation(error, "link_url")) {
      return t("admin.campaign_banners.validation.link_invalid");
    }
    if (
      rpcErrorHasFieldViolation(error, "starts_at") ||
      rpcErrorHasFieldViolation(error, "ends_at")
    ) {
      return t("admin.campaign_banners.validation.period_invalid");
    }
    return t("errors.validation");
  };
  const precondition = (): string | undefined => {
    if (rpcErrorHasReason(error, RPC_ERROR_REASON.campaignBannerLimit)) {
      return t("admin.campaign_banners.limit_reached");
    }
    if (mentionsStorageNotConfigured(error)) {
      return t("admin.errors.storage_not_configured");
    }
    return undefined;
  };

  return {
    "invalid-argument": invalidArgument(),
    precondition: precondition(),
  };
};

/** The generated `AdminCampaignBanner` fields {@link mapCampaignBanner} reads. */
type RawCampaignBanner = Pick<
  AdminCampaignBanner,
  | "endsAt"
  | "id"
  | "imageUpdatedAt"
  | "imageVariants"
  | "linkUrl"
  | "publicId"
  | "published"
  | "startsAt"
>;

const mapCampaignBanner = (banner: RawCampaignBanner): CampaignBannerItem => ({
  endsAt: banner.endsAt ?? "",
  id: banner.id ?? "",
  imageUpdatedAt: banner.imageUpdatedAt ?? "",
  imageVariants: (banner.imageVariants ?? []).flatMap((variant) => {
    const mappedVariant = {
      contentType: variant.contentType ?? "",
      fileSizeBytes: Number(variant.fileSizeBytes ?? 0),
      height: variant.height ?? 0,
      label: variant.label ?? "",
      url: variant.url ?? "",
      variantType: variant.variantType ?? "",
      width: variant.width ?? 0,
    };
    return mappedVariant.label.length > 0 && mappedVariant.url.length > 0
      ? [mappedVariant]
      : [];
  }),
  linkUrl: banner.linkUrl ?? "",
  publicId: banner.publicId ?? "",
  published: banner.published ?? false,
  startsAt: banner.startsAt ?? "",
});

const listCampaignBannersForSession = async (
  tenantId: string,
  locale: Locale,
  sessionId: string
): Promise<CachedRead<ListCampaignBannersResult>> => {
  "use cache: private";
  cacheTag(campaignBannersCacheTag(tenantId));

  const t = await getMessagesFor(locale);
  if (!sessionId) {
    dropFailedCacheEntry();
    return {
      banners: [],
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: true,
    };
  }

  try {
    const response = await apiClient.campaignBanners.listCampaignBanners(
      { tenant: { tenantId } },
      withSessionHeaders(sessionId)
    );

    return {
      banners: (response.banners ?? []).map((banner) =>
        mapCampaignBanner(banner)
      ),
      ok: true,
    };
  } catch (error) {
    // A `"use cache"` scope cannot rethrow: the fill would fail the whole
    // request. The entry is dropped instead, so the list comes back as soon
    // as the API does, and an unexpected failure is thrown by the caller.
    dropFailedCacheEntry();
    return {
      banners: [],
      message: rpcErrorMessage(error, t("admin.campaign_banners.list_failed"), {
        locale,
      }),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
      unexpected: rpcErrorDisposition(error) === "unexpected",
    };
  }
};

/**
 * Every banner of the tenant, expired and unpublished ones included, in the
 * order the tenant put them in.
 *
 * The API caps a tenant at 50 banners and answers them in one response, which
 * is also what lets a reorder post the whole order it was showing.
 *
 * Read with the operator's session: the API admits no service credential on
 * `ListCampaignBanners`, so the read stays private to the operator.
 */
export const listCampaignBanners = async (
  tenantId: string,
  locale: Locale
): Promise<ListCampaignBannersResult> =>
  settleCachedRead(
    await listCampaignBannersForSession(
      tenantId,
      locale,
      await getAccessToken()
    )
  );

/**
 * One banner of the tenant, for the screen it is edited on.
 *
 * Picked out of {@link listCampaignBanners}, which the console already reads
 * whole and files under the same tag, rather than read again by its own RPC.
 */
export const getCampaignBanner = async (
  input: { publicId: string; tenantId: string },
  locale: Locale
): Promise<GetCampaignBannerResult> => {
  const result = await listCampaignBanners(input.tenantId, locale);
  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
      requiresSignIn: result.requiresSignIn,
    };
  }

  const banner = result.banners.find(
    (candidate) => candidate.publicId === input.publicId
  );
  return banner ? { banner, ok: true } : { notFound: true, ok: false };
};

/** What a create and an update both carry. */
interface CampaignBannerFields {
  tenantId: string;
  linkUrl: string;
  startsAt: string;
  endsAt: string;
  published: boolean;
  imageContentType?: string;
  imageData?: Uint8Array;
}

/**
 * Creates a banner at the end of the tenant's order. The image is required:
 * the API refuses a banner without one rather than storing a band that shows
 * nothing.
 */
export const createCampaignBanner = async (
  input: CampaignBannerFields & { imageData: Uint8Array },
  locale: Locale
): Promise<SaveCampaignBannerResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.campaignBanners.createCampaignBanner(
      {
        endsAt: input.endsAt,
        imageContentType: input.imageContentType,
        imageData: input.imageData,
        linkUrl: input.linkUrl,
        published: input.published,
        startsAt: input.startsAt,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    if (!response.banner?.id?.trim()) {
      return { message: t("admin.campaign_banners.save_failed"), ok: false };
    }

    return { banner: mapCampaignBanner(response.banner), ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(error, t("admin.campaign_banners.save_failed"), {
        locale,
        overrides: await saveOverrides(error, locale),
      }),
      ok: false,
    };
  }
};

/**
 * Replaces the link, the window, and the published flag together, and the
 * whole image when one is sent. The API keeps the image the banner has when
 * none is, and has no way to clear it.
 */
export const updateCampaignBanner = async (
  input: CampaignBannerFields & { id: string },
  locale: Locale
): Promise<SaveCampaignBannerResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.campaignBanners.updateCampaignBanner(
      {
        campaignBannerId: input.id,
        endsAt: input.endsAt,
        imageContentType: input.imageContentType,
        imageData: input.imageData,
        linkUrl: input.linkUrl,
        published: input.published,
        startsAt: input.startsAt,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    if (!response.banner?.id?.trim()) {
      return { message: t("admin.campaign_banners.save_failed"), ok: false };
    }

    return { banner: mapCampaignBanner(response.banner), ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(error, t("admin.campaign_banners.save_failed"), {
        locale,
        overrides: await saveOverrides(error, locale),
      }),
      ok: false,
    };
  }
};

/**
 * Writes the tenant's banner order.
 *
 * `expectedIds` is the order the screen was showing when the operator dropped
 * the row. The API locks the tenant's banners, re-reads their order, and
 * refuses with a failed precondition when it no longer matches, so a console
 * left open while someone else added or moved a banner reports the conflict
 * instead of writing an order composed from a stale list.
 */
export const reorderCampaignBanners = async (
  input: {
    tenantId: string;
    ids: string[];
    expectedIds: string[];
  },
  locale: Locale
): Promise<ReorderCampaignBannersResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    await apiClient.campaignBanners.reorderCampaignBanners(
      {
        campaignBannerIds: input.ids,
        expectedCampaignBannerIds: input.expectedIds,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return { ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        t("admin.campaign_banners.reorder_failed"),
        {
          locale,
          overrides: {
            precondition: t("admin.campaign_banners.reorder_conflict"),
          },
        }
      ),
      ok: false,
    };
  }
};

/** Removes a banner and its image; the site stops showing it at once. */
export const deleteCampaignBanner = async (
  input: { tenantId: string; id: string },
  locale: Locale
): Promise<DeleteCampaignBannerResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    await apiClient.campaignBanners.deleteCampaignBanner(
      {
        campaignBannerId: input.id,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return { ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        t("admin.campaign_banners.delete_failed"),
        { locale }
      ),
      ok: false,
    };
  }
};

/**
 * Replaces the image of one aspect ratio of the banner. The other ratios keep
 * the images they already hold.
 */
export const uploadCampaignBannerAspectImage = async (
  input: {
    tenantId: string;
    id: string;
    variantType: string;
    imageContentType?: string;
    imageData: Uint8Array;
    /** Where in the upload the cut is taken; omitted, the API centres it. */
    crop?: CropRect;
  },
  locale: Locale
): Promise<CampaignBannerAspectResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response =
      await apiClient.campaignBanners.uploadCampaignBannerAspectImage(
        {
          campaignBannerId: input.id,
          crop: input.crop,
          imageContentType: input.imageContentType,
          imageData: input.imageData,
          tenant: { tenantId: input.tenantId },
          variantType: input.variantType,
        },
        withSessionHeaders(sessionId)
      );

    if (!response.banner?.id?.trim()) {
      return { message: t("admin.campaign_banners.save_failed"), ok: false };
    }

    return { banner: mapCampaignBanner(response.banner), ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    if (mentionsAspectImageRejection(error)) {
      return { imageRejected: true, ok: false };
    }
    return {
      message: rpcErrorMessage(error, t("admin.campaign_banners.save_failed"), {
        locale,
        overrides: {
          precondition: mentionsStorageNotConfigured(error)
            ? t("admin.errors.storage_not_configured")
            : undefined,
        },
      }),
      ok: false,
    };
  }
};
