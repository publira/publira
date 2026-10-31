import { ReaderIconPolicy } from "@publira/api-client/admin/types";
import type {
  ReaderIconPreset,
  UserIconVariant,
} from "@publira/api-client/admin/types";
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
import {
  mentionsIconRejection,
  mentionsStorageNotConfigured,
} from "./image-rejection";
import { getMessagesFor } from "./messages";
import { READER_ICON_PRESET_LIMIT } from "./reader-icon-settings-shared";
import type { TenantReaderIconPolicy } from "./reader-icon-settings-shared";
import { getAccessToken } from "./session";

export type GetTenantReaderIconPolicyResult =
  | { ok: true; policy: TenantReaderIconPolicy }
  | {
      ok: false;
      message: string;
      /**
       * No policy. A read that failed has no saved choice to report, and the
       * card would otherwise offer to save one nobody chose over the stored
       * one — and a narrower one clears the icons readers show.
       */
      requiresSignIn: boolean;
    };

export type UpdateTenantReaderIconPolicyResult =
  | { ok: true; policy: TenantReaderIconPolicy }
  | { ok: false; message: string };

/** One stored rendition of a preset, as the gallery describes it. */
export interface ReaderIconPresetVariant {
  contentType: string;
  fileSizeBytes: number;
  height: number;
  label: string;
  url: string;
  width: number;
}

/** An icon the tenant offers its readers to pick. */
export interface ReaderIconPresetItem {
  id: string;
  /** The stored renditions, largest first. */
  variants: ReaderIconPresetVariant[];
}

export type ListReaderIconPresetsResult =
  | { ok: true; presets: ReaderIconPresetItem[] }
  | { ok: false; message: string; requiresSignIn: boolean };

export type ReaderIconPresetWriteResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Tag the reader icon tab's cached policy read carries, so `updateTag` in the
 * Server Action makes the saved choice visible in the same session instead of
 * leaving the previous one in the private cache.
 */
export const tenantReaderIconPolicyCacheTag = (tenantId: string): string =>
  `tenant:${tenantId.trim()}:reader-icon-policy`;

/** Tag the preset gallery's cached read carries, dropped by every preset write. */
export const tenantReaderIconPresetsCacheTag = (tenantId: string): string =>
  `tenant:${tenantId.trim()}:reader-icon-presets`;

/**
 * `READER_ICON_POLICY_UNSPECIFIED` names no policy, so it resolves to nothing
 * rather than to `upload`: the API never answers it for a stored choice, and
 * reporting it as one would put a guess in front of the operator as the
 * tenant's own setting.
 */
const toTenantReaderIconPolicy = (
  policy: ReaderIconPolicy | undefined
): TenantReaderIconPolicy | undefined => {
  switch (policy) {
    case ReaderIconPolicy.UPLOAD: {
      return "upload";
    }

    case ReaderIconPolicy.PRESET: {
      return "preset";
    }

    case ReaderIconPolicy.DISABLED: {
      return "disabled";
    }

    default: {
      return undefined;
    }
  }
};

const toReaderIconPolicyEnum = (
  policy: TenantReaderIconPolicy
): ReaderIconPolicy => {
  switch (policy) {
    case "preset": {
      return ReaderIconPolicy.PRESET;
    }

    case "disabled": {
      return ReaderIconPolicy.DISABLED;
    }

    default: {
      return ReaderIconPolicy.UPLOAD;
    }
  }
};

/**
 * The generated `ReaderIconPreset` and `UserIconVariant` fields
 * {@link toReaderIconPresetItem} reads.
 */
type RawReaderIconPresetVariant = Pick<
  UserIconVariant,
  "contentType" | "fileSizeBytes" | "height" | "label" | "url" | "width"
>;

type RawReaderIconPreset = Pick<ReaderIconPreset, "id"> & {
  variants: readonly RawReaderIconPresetVariant[];
};

/**
 * A variant without a URL cannot be drawn, so it is left out rather than shown
 * as a broken image.
 */
const toReaderIconPresetItem = (
  preset: RawReaderIconPreset
): ReaderIconPresetItem => ({
  id: preset.id,
  variants: preset.variants.flatMap((variant) =>
    variant.url
      ? [
          {
            contentType: variant.contentType ?? "",
            fileSizeBytes: Number(variant.fileSizeBytes ?? 0),
            height: variant.height ?? 0,
            label: variant.label ?? "",
            url: variant.url,
            width: variant.width ?? 0,
          },
        ]
      : []
  ),
});

const getTenantReaderIconPolicyForSession = async (
  tenantId: string,
  locale: Locale,
  sessionId: string
): Promise<CachedRead<GetTenantReaderIconPolicyResult>> => {
  "use cache: private";

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

  cacheTag(tenantReaderIconPolicyCacheTag(normalizedTenantId));

  try {
    const response = await apiClient.tenantSettings.getTenantReaderIconPolicy(
      { tenant: { tenantId: normalizedTenantId } },
      withSessionHeaders(sessionId)
    );

    const policy = toTenantReaderIconPolicy(response.policy);

    if (policy === undefined) {
      dropFailedCacheEntry();

      return {
        message: t("admin.settings.reader_icons.policy.load_failed"),
        ok: false,
        requiresSignIn: false,
      };
    }

    return { ok: true, policy };
  } catch (error) {
    dropFailedCacheEntry();

    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.reader_icons.policy.load_failed"),
        { locale }
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
      unexpected: rpcErrorDisposition(error) === "unexpected",
    };
  }
};

export const getTenantReaderIconPolicy = async (
  tenantId: string,
  locale: Locale
): Promise<GetTenantReaderIconPolicyResult> =>
  settleCachedRead(
    await getTenantReaderIconPolicyForSession(
      tenantId,
      locale,
      await getAccessToken()
    )
  );

const listReaderIconPresetsForSession = async (
  tenantId: string,
  locale: Locale,
  sessionId: string
): Promise<CachedRead<ListReaderIconPresetsResult>> => {
  "use cache: private";

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

  cacheTag(tenantReaderIconPresetsCacheTag(normalizedTenantId));

  try {
    const response = await apiClient.tenantSettings.listReaderIconPresets(
      { tenant: { tenantId: normalizedTenantId } },
      withSessionHeaders(sessionId)
    );

    return {
      ok: true,
      presets: response.presets.map(toReaderIconPresetItem),
    };
  } catch (error) {
    dropFailedCacheEntry();

    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.reader_icons.presets.load_failed"),
        { locale }
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
      unexpected: rpcErrorDisposition(error) === "unexpected",
    };
  }
};

export const listReaderIconPresets = async (
  tenantId: string,
  locale: Locale
): Promise<ListReaderIconPresetsResult> =>
  settleCachedRead(
    await listReaderIconPresetsForSession(
      tenantId,
      locale,
      await getAccessToken()
    )
  );

export const updateTenantReaderIconPolicy = async (
  input: { policy: TenantReaderIconPolicy; tenantId: string },
  locale: Locale
): Promise<UpdateTenantReaderIconPolicyResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  const normalizedTenantId = input.tenantId.trim();

  if (!normalizedTenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response =
      await apiClient.tenantSettings.updateTenantReaderIconPolicy(
        {
          policy: toReaderIconPolicyEnum(input.policy),
          tenant: { tenantId: normalizedTenantId },
        },
        withSessionHeaders(sessionId)
      );

    const saved = toTenantReaderIconPolicy(response.policy);

    if (saved === undefined) {
      return {
        message: t("admin.settings.reader_icons.policy.save_failed"),
        ok: false,
      };
    }

    return { ok: true, policy: saved };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.reader_icons.policy.save_failed"),
        { locale }
      ),
      ok: false,
    };
  }
};

/**
 * A `failed_precondition` refusal of a preset upload names one of two causes,
 * each only someone else can clear: the platform has no object store, or the
 * tenant holds as many presets as it may.
 */
const uploadPreconditionMessage = async (
  error: unknown,
  locale: Locale
): Promise<string | undefined> => {
  const t = await getMessagesFor(locale);

  if (mentionsStorageNotConfigured(error)) {
    return t("admin.errors.storage_not_configured");
  }

  if (rpcErrorHasReason(error, RPC_ERROR_REASON.readerIconPresetLimit)) {
    return t("admin.settings.reader_icons.presets.limit_reached", {
      limit: READER_ICON_PRESET_LIMIT,
    });
  }

  return undefined;
};

/**
 * The upload's refusals are worded here rather than taken from the server,
 * which answers in English. An image the server cannot cut a large enough
 * square from is refused on `icon_data`, or on `icon_crop` when the rectangle
 * is at fault; the console sends no rectangle, so both mean the image itself.
 */
export const uploadReaderIconPreset = async (
  input: { iconContentType: string; iconData: Uint8Array; tenantId: string },
  locale: Locale
): Promise<ReaderIconPresetWriteResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  const normalizedTenantId = input.tenantId.trim();

  if (!normalizedTenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    await apiClient.tenantSettings.uploadReaderIconPreset(
      {
        iconContentType: input.iconContentType,
        iconData: input.iconData,
        tenant: { tenantId: normalizedTenantId },
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
        t("admin.settings.reader_icons.presets.upload_failed"),
        {
          locale,
          overrides: {
            "invalid-argument":
              mentionsIconRejection(error) ||
              rpcErrorHasFieldViolation(error, "icon_crop")
                ? t("admin.settings.reader_icons.presets.rejected")
                : undefined,
            precondition: await uploadPreconditionMessage(error, locale),
          },
        }
      ),
      ok: false,
    };
  }
};

export const deleteReaderIconPreset = async (
  input: { presetId: string; tenantId: string },
  locale: Locale
): Promise<ReaderIconPresetWriteResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  const normalizedTenantId = input.tenantId.trim();

  if (!normalizedTenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    await apiClient.tenantSettings.deleteReaderIconPreset(
      { presetId: input.presetId, tenant: { tenantId: normalizedTenantId } },
      withSessionHeaders(sessionId)
    );

    return { ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.reader_icons.presets.delete_failed"),
        {
          locale,
          overrides: {
            "not-found": t(
              "admin.settings.reader_icons.presets.already_deleted"
            ),
          },
        }
      ),
      ok: false,
    };
  }
};
