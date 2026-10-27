import type { AdminTenantBrandMark } from "@publira/api-client/admin/types";
import { TenantBrandMarkKind } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
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
import { mentionsStorageNotConfigured } from "./image-rejection";
import { getMessagesFor } from "./messages";
import { getAccessToken } from "./session";
import { toTenantBrandingImage } from "./tenant-branding-image";
import type { TenantBrandingImage } from "./tenant-branding-image";

/**
 * The third-party marks a tenant can upload, in the order the branding screen
 * lists them. Each is the lower snake case name the API files its image under.
 */
export const BRAND_MARK_KINDS = [
  "x_share",
  "line_share",
  "app_store_badge",
  "google_play_badge",
  "apple_sign_in",
  "google_sign_in",
] as const;

export type BrandMarkKind = (typeof BRAND_MARK_KINDS)[number];

const BRAND_MARK_KIND_TO_PROTO: Record<BrandMarkKind, TenantBrandMarkKind> = {
  app_store_badge: TenantBrandMarkKind.APP_STORE_BADGE,
  apple_sign_in: TenantBrandMarkKind.APPLE_SIGN_IN,
  google_play_badge: TenantBrandMarkKind.GOOGLE_PLAY_BADGE,
  google_sign_in: TenantBrandMarkKind.GOOGLE_SIGN_IN,
  line_share: TenantBrandMarkKind.LINE_SHARE,
  x_share: TenantBrandMarkKind.X_SHARE,
};

/** `undefined` for a kind this console does not know yet. */
const fromProtoKind = (kind: TenantBrandMarkKind): BrandMarkKind | undefined =>
  BRAND_MARK_KINDS.find((name) => BRAND_MARK_KIND_TO_PROTO[name] === kind);

/** A mark the tenant has uploaded, with the consent it was uploaded under. */
export interface TenantBrandMark {
  kind: BrandMarkKind;
  image: TenantBrandingImage;
  /** The owner's guideline page the console showed when it was accepted. */
  termsUrl: string;
  termsAcceptedAt: string;
  /** Empty once the account that accepted has been deleted. */
  termsAcceptedByName: string;
}

export type TenantBrandMarks = Partial<Record<BrandMarkKind, TenantBrandMark>>;

export type TenantBrandMarksResult =
  | { ok: true; marks: TenantBrandMarks }
  | {
      ok: false;
      message: string;
      /** The API rejected the session while reading the marks. */
      requiresSignIn?: boolean;
    };

export type TenantBrandMarkResult =
  | { ok: true; mark: TenantBrandMark | null }
  | { ok: false; message: string };

export interface UploadTenantBrandMarkInput {
  tenantId: string;
  kind: BrandMarkKind;
  imageContentType: string;
  imageData: Uint8Array;
  termsUrl: string;
}

/**
 * Tag the branding screen's read of the marks carries, so `updateTag` in a
 * Server Action shows an upload or a deletion in the same session.
 */
export const tenantBrandMarksCacheTag = (tenantId: string): string =>
  `tenant:${tenantId.trim()}:brand-marks`;

/**
 * The generated `AdminTenantBrandMark` fields {@link toTenantBrandMark} reads.
 * The mark itself is the public `TenantBrandMark`, whose own fields are read
 * through the same message.
 */
type RawTenantBrandMark = Pick<
  AdminTenantBrandMark,
  "mark" | "termsAcceptedByUserName"
>;

/** `null` for an unknown kind, and for a mark whose image did not arrive. */
const toTenantBrandMark = (
  raw: RawTenantBrandMark | undefined
): TenantBrandMark | null => {
  const kind = raw?.mark ? fromProtoKind(raw.mark.kind) : undefined;
  const image = toTenantBrandingImage(
    raw?.mark?.imageUpdatedAt,
    raw?.mark?.imageVariants
  );
  if (!(kind && image)) {
    return null;
  }

  return {
    image,
    kind,
    termsAcceptedAt: raw?.mark?.termsAcceptedAt ?? "",
    termsAcceptedByName: raw?.termsAcceptedByUserName ?? "",
    termsUrl: raw?.mark?.termsUrl ?? "",
  };
};

/**
 * The rejections an upload can meet are worded here rather than taken from the
 * server, which answers in English. The `image_data` field violation is what
 * separates a rejected image from a bad kind or terms URL, which the console
 * never sends.
 */
const parseBrandMarkErrorMessage = async (
  error: unknown,
  fallback: string,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);
  let precondition: string | undefined;
  if (rpcErrorHasReason(error, RPC_ERROR_REASON.brandMarkTermsNotAccepted)) {
    precondition = t("admin.settings.brand_marks.terms_required");
  } else if (mentionsStorageNotConfigured(error)) {
    precondition = t("admin.errors.storage_not_configured");
  }

  return rpcErrorMessage(error, fallback, {
    locale,
    overrides: {
      "invalid-argument": rpcErrorHasFieldViolation(error, "image_data")
        ? t("admin.settings.brand_marks.rejected")
        : undefined,
      precondition,
    },
  });
};

const getTenantBrandMarksForSession = async (
  tenantId: string,
  locale: Locale,
  sessionId: string
): Promise<CachedRead<TenantBrandMarksResult>> => {
  "use cache: private";

  cacheTag(tenantBrandMarksCacheTag(tenantId));

  const t = await getMessagesFor(locale);
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    dropFailedCacheEntry();
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: !sessionId,
    };
  }

  try {
    const response = await apiClient.brandMarks.listTenantBrandMarks(
      { tenant: { tenantId: normalizedTenantId } },
      withSessionHeaders(sessionId)
    );

    const marks: TenantBrandMarks = {};
    for (const raw of response.brandMarks ?? []) {
      const mark = toTenantBrandMark(raw);
      if (mark) {
        marks[mark.kind] = mark;
      }
    }
    return { marks, ok: true };
  } catch (error) {
    dropFailedCacheEntry();
    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.brand_marks.load_failed"),
        { locale }
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
      unexpected: rpcErrorDisposition(error) === "unexpected",
    };
  }
};

/** Every mark the tenant has uploaded, keyed by its kind. */
export const getTenantBrandMarks = async (
  tenantId: string,
  locale: Locale
): Promise<TenantBrandMarksResult> =>
  settleCachedRead(
    await getTenantBrandMarksForSession(
      tenantId,
      locale,
      await getAccessToken()
    )
  );

/**
 * Stores the image as the tenant's mark of its kind, recording `termsUrl` as
 * the guidelines the administrator accepted. Only the Action that has checked
 * that acceptance calls it, so it always sends `termsAccepted`.
 */
export const uploadTenantBrandMark = async (
  input: UploadTenantBrandMarkInput,
  locale: Locale
): Promise<TenantBrandMarkResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  const normalizedTenantId = input.tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.brandMarks.uploadTenantBrandMark(
      {
        imageContentType: input.imageContentType,
        imageData: input.imageData,
        kind: BRAND_MARK_KIND_TO_PROTO[input.kind],
        tenant: { tenantId: normalizedTenantId },
        termsAccepted: true,
        termsUrl: input.termsUrl,
      },
      withSessionHeaders(sessionId)
    );

    return { mark: toTenantBrandMark(response.brandMark), ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: await parseBrandMarkErrorMessage(
        error,
        t("admin.settings.brand_marks.upload_failed"),
        locale
      ),
      ok: false,
    };
  }
};

/** Deletes the tenant's mark of a kind together with its consent record. */
export const deleteTenantBrandMark = async (
  tenantId: string,
  kind: BrandMarkKind,
  locale: Locale
): Promise<TenantBrandMarkResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    await apiClient.brandMarks.deleteTenantBrandMark(
      {
        kind: BRAND_MARK_KIND_TO_PROTO[kind],
        tenant: { tenantId: normalizedTenantId },
      },
      withSessionHeaders(sessionId)
    );

    return { mark: null, ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: await parseBrandMarkErrorMessage(
        error,
        t("admin.settings.brand_marks.delete_failed"),
        locale
      ),
      ok: false,
    };
  }
};
