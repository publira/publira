import type {
  CommunityLimitDefaults,
  HourDayLimit as HourDayLimitMessage,
  MinuteDayLimit as MinuteDayLimitMessage,
  TenantCommunityLimitOverrides as TenantCommunityLimitOverridesMessage,
} from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import { rethrowUnclassifiedRpcError } from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";
import { cacheTag } from "next/cache";

import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import { getMessagesFor } from "./messages";
import type { AdminMessageAccessor } from "./messages";
import { getAccessToken } from "./session";
import type { HourDayLimit, MinuteDayLimit } from "./tenant-policy-shared";

/** The abuse-control limits a tenant's storefront is served under. */
export interface TenantCommunityLimits {
  commentPost: MinuteDayLimit;
  commentReport: MinuteDayLimit;
  contactMessagePerAccount: HourDayLimit;
  contactMessagePerClient: HourDayLimit;
  duplicateCommentWindowMinutes: number;
  episodeRating: MinuteDayLimit;
  viewerPreferences: MinuteDayLimit;
}

/**
 * What the tenant has saved. An absent field follows the platform value; a
 * present one may only be stricter.
 */
export type TenantCommunityLimitOverrides = Partial<TenantCommunityLimits>;

/** Which limit a rejected save names, so the screen can word which row is wrong. */
export type CommunityLimitKey = keyof TenantCommunityLimits;

export interface TenantCommunityLimitSettings {
  overrides: TenantCommunityLimitOverrides;
  platformDefaults: TenantCommunityLimits;
  /** Decimal int64 the screen sends back with its save; `"0"` means nothing saved yet. */
  revision: string;
}

export type GetTenantCommunityLimitSettingsResult =
  | ({ ok: true } & TenantCommunityLimitSettings)
  | {
      ok: false;
      message: string;
      /** No limits: a failed read has nothing the screen could offer for editing. */
      requiresSignIn: boolean;
    };

export type UpdateTenantCommunityLimitSettingsResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Tag the screen's cached read carries, so `updateTag` in the Server Action
 * shows the saved limits and their new revision in the same session.
 */
export const tenantCommunityLimitsCacheTag = (tenantId: string): string =>
  `tenant:${tenantId.trim()}:community-limits`;

type RawMinuteDayLimit = Pick<MinuteDayLimitMessage, "perDay" | "perMinute">;
type RawHourDayLimit = Pick<HourDayLimitMessage, "perDay" | "perHour">;

type RawCommunityLimits = Pick<
  CommunityLimitDefaults,
  | "commentPost"
  | "commentReport"
  | "contactMessagePerAccount"
  | "contactMessagePerClient"
  | "duplicateCommentWindowMinutes"
  | "episodeRating"
  | "viewerPreferences"
>;

type RawTenantCommunityLimitOverrides = Pick<
  TenantCommunityLimitOverridesMessage,
  | "commentPost"
  | "commentReport"
  | "contactMessagePerAccount"
  | "contactMessagePerClient"
  | "duplicateCommentWindowMinutes"
  | "episodeRating"
  | "viewerPreferences"
>;

const toMinuteDayLimit = (
  limit: RawMinuteDayLimit | undefined
): MinuteDayLimit => ({
  perDay: limit?.perDay ?? 0,
  perMinute: limit?.perMinute ?? 0,
});

const toHourDayLimit = (limit: RawHourDayLimit | undefined): HourDayLimit => ({
  perDay: limit?.perDay ?? 0,
  perHour: limit?.perHour ?? 0,
});

/** An override group is present or absent as a whole, never a pair of zeroes. */
const toOptionalMinuteDayLimit = (
  limit: RawMinuteDayLimit | undefined
): MinuteDayLimit | undefined =>
  limit === undefined ? undefined : toMinuteDayLimit(limit);

const toOptionalHourDayLimit = (
  limit: RawHourDayLimit | undefined
): HourDayLimit | undefined =>
  limit === undefined ? undefined : toHourDayLimit(limit);

const toCommunityLimits = (
  limits: RawCommunityLimits | undefined
): TenantCommunityLimits => ({
  commentPost: toMinuteDayLimit(limits?.commentPost),
  commentReport: toMinuteDayLimit(limits?.commentReport),
  contactMessagePerAccount: toHourDayLimit(limits?.contactMessagePerAccount),
  contactMessagePerClient: toHourDayLimit(limits?.contactMessagePerClient),
  duplicateCommentWindowMinutes: limits?.duplicateCommentWindowMinutes ?? 0,
  episodeRating: toMinuteDayLimit(limits?.episodeRating),
  viewerPreferences: toMinuteDayLimit(limits?.viewerPreferences),
});

const toCommunityLimitOverrides = (
  overrides: RawTenantCommunityLimitOverrides | undefined
): TenantCommunityLimitOverrides => ({
  commentPost: toOptionalMinuteDayLimit(overrides?.commentPost),
  commentReport: toOptionalMinuteDayLimit(overrides?.commentReport),
  contactMessagePerAccount: toOptionalHourDayLimit(
    overrides?.contactMessagePerAccount
  ),
  contactMessagePerClient: toOptionalHourDayLimit(
    overrides?.contactMessagePerClient
  ),
  duplicateCommentWindowMinutes: overrides?.duplicateCommentWindowMinutes,
  episodeRating: toOptionalMinuteDayLimit(overrides?.episodeRating),
  viewerPreferences: toOptionalMinuteDayLimit(overrides?.viewerPreferences),
});

const minuteDayIsLooser = (
  override: MinuteDayLimit | undefined,
  platform: MinuteDayLimit
): boolean =>
  override !== undefined &&
  (override.perMinute > platform.perMinute ||
    override.perDay > platform.perDay);

const hourDayIsLooser = (
  override: HourDayLimit | undefined,
  platform: HourDayLimit
): boolean =>
  override !== undefined &&
  (override.perHour > platform.perHour || override.perDay > platform.perDay);

/**
 * The first limit set looser than the platform allows — a higher count, or a
 * shorter duplicate-comment window — so the screen can name the row it refused.
 */
export const findLooserCommunityLimit = (
  overrides: TenantCommunityLimitOverrides,
  platformDefaults: TenantCommunityLimits
): CommunityLimitKey | undefined => {
  if (minuteDayIsLooser(overrides.commentPost, platformDefaults.commentPost)) {
    return "commentPost";
  }
  if (
    minuteDayIsLooser(overrides.commentReport, platformDefaults.commentReport)
  ) {
    return "commentReport";
  }
  if (
    hourDayIsLooser(
      overrides.contactMessagePerAccount,
      platformDefaults.contactMessagePerAccount
    )
  ) {
    return "contactMessagePerAccount";
  }
  if (
    hourDayIsLooser(
      overrides.contactMessagePerClient,
      platformDefaults.contactMessagePerClient
    )
  ) {
    return "contactMessagePerClient";
  }
  if (
    overrides.duplicateCommentWindowMinutes !== undefined &&
    overrides.duplicateCommentWindowMinutes <
      platformDefaults.duplicateCommentWindowMinutes
  ) {
    return "duplicateCommentWindowMinutes";
  }
  if (
    minuteDayIsLooser(overrides.episodeRating, platformDefaults.episodeRating)
  ) {
    return "episodeRating";
  }
  if (
    minuteDayIsLooser(
      overrides.viewerPreferences,
      platformDefaults.viewerPreferences
    )
  ) {
    return "viewerPreferences";
  }

  return undefined;
};

/**
 * The heading the screen shows a limit under. Each key is spelled out in its
 * own branch so every string the console renders stays findable in the source.
 */
const communityLimitName = (
  key: CommunityLimitKey,
  t: AdminMessageAccessor
): string => {
  switch (key) {
    case "commentPost": {
      return t("admin.settings.policy.community.comment_post_legend");
    }
    case "commentReport": {
      return t("admin.settings.policy.community.comment_report_legend");
    }
    case "contactMessagePerAccount": {
      return t("admin.settings.policy.community.contact_per_account_legend");
    }
    case "contactMessagePerClient": {
      return t("admin.settings.policy.community.contact_per_client_legend");
    }
    case "duplicateCommentWindowMinutes": {
      return t("admin.settings.policy.community.duplicate_window_legend");
    }
    case "episodeRating": {
      return t("admin.settings.policy.community.episode_rating_legend");
    }
    default: {
      return t("admin.settings.policy.community.viewer_preferences_legend");
    }
  }
};

export const getTenantCommunityLimitSettings = async (
  tenantId: string,
  locale: Locale
): Promise<GetTenantCommunityLimitSettingsResult> => {
  "use cache: private";

  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: !sessionId,
    };
  }

  cacheTag(tenantCommunityLimitsCacheTag(normalizedTenantId));

  try {
    const response =
      await apiClient.tenantSettings.getTenantCommunityLimitSettings(
        { tenant: { tenantId: normalizedTenantId } },
        withSessionHeaders(sessionId)
      );

    return {
      ok: true,
      overrides: toCommunityLimitOverrides(response.overrides),
      platformDefaults: toCommunityLimits(response.platformDefaults),
      revision: String(response.revision),
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.policy.community.load_failed"),
        { locale }
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

/**
 * Save the tenant's own limits, reading the platform values again first so a
 * limit looser than they allow is reported by name rather than by proto field.
 */
export const updateTenantCommunityLimitSettings = async (
  input: {
    expectedRevision: bigint;
    overrides: TenantCommunityLimitOverrides;
    tenantId: string;
  },
  locale: Locale
): Promise<UpdateTenantCommunityLimitSettingsResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  const normalizedTenantId = input.tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const current =
      await apiClient.tenantSettings.getTenantCommunityLimitSettings(
        { tenant: { tenantId: normalizedTenantId } },
        withSessionHeaders(sessionId)
      );
    const looser = findLooserCommunityLimit(
      input.overrides,
      toCommunityLimits(current.platformDefaults)
    );
    if (looser) {
      return {
        message: t("admin.settings.policy.community.too_loose", {
          setting: communityLimitName(looser, t),
        }),
        ok: false,
      };
    }

    await apiClient.tenantSettings.updateTenantCommunityLimitSettings(
      {
        expectedRevision: input.expectedRevision,
        // Every group is written: one left out clears that override.
        overrides: {
          commentPost: input.overrides.commentPost,
          commentReport: input.overrides.commentReport,
          contactMessagePerAccount: input.overrides.contactMessagePerAccount,
          contactMessagePerClient: input.overrides.contactMessagePerClient,
          duplicateCommentWindowMinutes:
            input.overrides.duplicateCommentWindowMinutes,
          episodeRating: input.overrides.episodeRating,
          viewerPreferences: input.overrides.viewerPreferences,
        },
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
        t("admin.settings.policy.community.save_failed"),
        {
          locale,
          overrides: {
            precondition: t("admin.settings.policy.save_conflict"),
          },
        }
      ),
      ok: false,
    };
  }
};
