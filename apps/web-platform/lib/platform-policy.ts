import { rpcErrorMessage } from "@publira/api-client/error-messages";
import { rethrowUnclassifiedRpcError } from "@publira/api-client/errors";
import type {
  CommunityLimitDefaults,
  HourDayLimit,
  MinuteDayLimit,
  PlatformPolicy as RawPlatformPolicyMessage,
  RetentionPeriods,
} from "@publira/api-client/platform/types";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheLife, cacheTag } from "next/cache";

import {
  SHARED_READ_CACHE_LIFE,
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
  withServiceHeaders,
} from "./api-client";
import { verifyPlatformSession } from "./auth-session";
import { rethrowUnauthenticatedRpcError } from "./auth-shared";
import { getPlatformLocale } from "./locale";
import { getMessagesFor } from "./messages";

export interface MinuteDay {
  perDay: number;
  perMinute: number;
}

export interface HourDay {
  perDay: number;
  perHour: number;
}

export interface PlatformSecurityPolicy {
  /** Where the disposable email domain list is read from; empty for none. */
  disposableEmailDomainsUrl: string;
  loginAttemptsPerAccount: MinuteDay;
  loginAttemptsPerSource: HourDay;
  mailRequestsPerAddress: HourDay;
  mailRequestsPerSource: HourDay;
  mfaRequiredForTenantAdmin: boolean;
  passwordVerification: MinuteDay;
  storePurchaseConfirmation: MinuteDay;
  waitFreeTicketUse: MinuteDay;
}

export interface PlatformCommunityLimits {
  commentPost: MinuteDay;
  commentReport: MinuteDay;
  contactMessagePerAccount: HourDay;
  contactMessagePerClient: HourDay;
  duplicateCommentWindowMinutes: number;
  episodeRating: MinuteDay;
  viewerPreferences: MinuteDay;
}

export interface PlatformPolicy {
  community: PlatformCommunityLimits;
  security: PlatformSecurityPolicy;
}

export interface PlatformRetentionDefaults {
  contentEventDays: number;
  dailyRankingSnapshotDays: number;
  weeklyRankingSnapshotDays: number;
  withdrawnCommentDays: number;
}

/**
 * A read of a settings row. `revision` is the decimal int64 the screen sends
 * back with its save; `"0"` means nothing has been saved and the values are the
 * built-in defaults.
 */
export type GetPlatformSettingsRowResult<T> =
  | { ok: true; revision: string; values: T }
  | { message: string; ok: false };

export type SavePlatformSettingsRowResult =
  | { ok: true }
  | { message: string; ok: false };

/**
 * Tag the cached policy read carries. The security and community screens read
 * the same row, so one save clears both.
 */
export const platformPolicyCacheTag = "platform:policy";

export const platformRetentionDefaultsCacheTag = "platform:retention-defaults";

type RawMinuteDay = Pick<MinuteDayLimit, "perDay" | "perMinute">;
type RawHourDay = Pick<HourDayLimit, "perDay" | "perHour">;
type RawCommunityLimitDefaults = Pick<
  CommunityLimitDefaults,
  | "commentPost"
  | "commentReport"
  | "contactMessagePerAccount"
  | "contactMessagePerClient"
  | "duplicateCommentWindowMinutes"
  | "episodeRating"
  | "viewerPreferences"
>;
type RawPlatformPolicy = Pick<
  RawPlatformPolicyMessage,
  | "communityLimitDefaults"
  | "disposableEmailDomainsUrl"
  | "loginAttemptsPerAccount"
  | "loginAttemptsPerSource"
  | "mailRequestsPerAddress"
  | "mailRequestsPerSource"
  | "mfaRequiredForTenantAdmin"
  | "passwordVerification"
  | "storePurchaseConfirmation"
  | "waitFreeTicketUse"
>;
type RawRetentionPeriods = Pick<
  RetentionPeriods,
  | "contentEventDays"
  | "dailyRankingSnapshotDays"
  | "weeklyRankingSnapshotDays"
  | "withdrawnCommentDays"
>;

const toMinuteDay = (limit: RawMinuteDay | undefined): MinuteDay => ({
  perDay: limit?.perDay ?? 0,
  perMinute: limit?.perMinute ?? 0,
});

const toHourDay = (limit: RawHourDay | undefined): HourDay => ({
  perDay: limit?.perDay ?? 0,
  perHour: limit?.perHour ?? 0,
});

const toCommunityLimits = (
  community: RawCommunityLimitDefaults | undefined
): PlatformCommunityLimits => ({
  commentPost: toMinuteDay(community?.commentPost),
  commentReport: toMinuteDay(community?.commentReport),
  contactMessagePerAccount: toHourDay(community?.contactMessagePerAccount),
  contactMessagePerClient: toHourDay(community?.contactMessagePerClient),
  duplicateCommentWindowMinutes: community?.duplicateCommentWindowMinutes ?? 0,
  episodeRating: toMinuteDay(community?.episodeRating),
  viewerPreferences: toMinuteDay(community?.viewerPreferences),
});

export const toPlatformPolicy = (
  policy: RawPlatformPolicy | undefined
): PlatformPolicy => ({
  community: toCommunityLimits(policy?.communityLimitDefaults),
  security: {
    disposableEmailDomainsUrl: policy?.disposableEmailDomainsUrl ?? "",
    loginAttemptsPerAccount: toMinuteDay(policy?.loginAttemptsPerAccount),
    loginAttemptsPerSource: toHourDay(policy?.loginAttemptsPerSource),
    mailRequestsPerAddress: toHourDay(policy?.mailRequestsPerAddress),
    mailRequestsPerSource: toHourDay(policy?.mailRequestsPerSource),
    mfaRequiredForTenantAdmin: policy?.mfaRequiredForTenantAdmin ?? false,
    passwordVerification: toMinuteDay(policy?.passwordVerification),
    storePurchaseConfirmation: toMinuteDay(policy?.storePurchaseConfirmation),
    waitFreeTicketUse: toMinuteDay(policy?.waitFreeTicketUse),
  },
});

export const toPlatformRetentionDefaults = (
  periods: RawRetentionPeriods | undefined
): PlatformRetentionDefaults => ({
  contentEventDays: periods?.contentEventDays ?? 0,
  dailyRankingSnapshotDays: periods?.dailyRankingSnapshotDays ?? 0,
  weeklyRankingSnapshotDays: periods?.weeklyRankingSnapshotDays ?? 0,
  withdrawnCommentDays: periods?.withdrawnCommentDays ?? 0,
});

/**
 * A failed read, as a value: a `"use cache"` scope cannot rethrow, because the
 * fill would fail the whole request. The entry is dropped instead, so the
 * screen comes back as soon as the API does.
 */
const readFailure = async (
  error: unknown,
  locale: Locale
): Promise<{ message: string; ok: false }> => {
  dropFailedCacheEntry();
  const t = await getMessagesFor(locale);
  return {
    message: rpcErrorMessage(error, t("platform.policy.load_failed"), {
      locale,
    }),
    ok: false,
  };
};

const getPlatformPolicyForLocale = async (
  locale: Locale
): Promise<GetPlatformSettingsRowResult<PlatformPolicy>> => {
  "use cache";
  cacheLife(SHARED_READ_CACHE_LIFE);
  cacheTag(platformPolicyCacheTag);

  try {
    const response = await apiClient.policy.getPlatformPolicy(
      {},
      withServiceHeaders()
    );
    return {
      ok: true,
      revision: String(response.revision),
      values: toPlatformPolicy(response.policy),
    };
  } catch (error) {
    return readFailure(error, locale);
  }
};

/**
 * The platform policy, for the security and community screens.
 *
 * Read with the service credential: the policy is the same for every
 * operator, so one entry serves all of them.
 */
export const getPlatformPolicy = async (): Promise<
  GetPlatformSettingsRowResult<PlatformPolicy>
> => {
  await verifyPlatformSession();
  return getPlatformPolicyForLocale(await getPlatformLocale());
};

const getPlatformRetentionDefaultsForLocale = async (
  locale: Locale
): Promise<GetPlatformSettingsRowResult<PlatformRetentionDefaults>> => {
  "use cache";
  cacheLife(SHARED_READ_CACHE_LIFE);
  cacheTag(platformRetentionDefaultsCacheTag);

  try {
    const response = await apiClient.policy.getPlatformRetentionDefaults(
      {},
      withServiceHeaders()
    );
    return {
      ok: true,
      revision: String(response.revision),
      values: toPlatformRetentionDefaults(response.defaults),
    };
  } catch (error) {
    return readFailure(error, locale);
  }
};

/**
 * The platform's retention defaults, read with the service credential like
 * {@link getPlatformPolicy}.
 */
export const getPlatformRetentionDefaults = async (): Promise<
  GetPlatformSettingsRowResult<PlatformRetentionDefaults>
> => {
  await verifyPlatformSession();
  return getPlatformRetentionDefaultsForLocale(await getPlatformLocale());
};

/**
 * The screens mirror every rule the server enforces, so an `invalid-argument`
 * is a forged or outdated form; its message names proto fields rather than
 * anything on screen, so the screen's own wording replaces it.
 */
const saveFailure = async (
  error: unknown,
  locale: Locale
): Promise<{ message: string; ok: false }> => {
  rethrowUnauthenticatedRpcError(error);
  rethrowUnclassifiedRpcError(error);
  const t = await getMessagesFor(locale);
  return {
    message: rpcErrorMessage(error, t("platform.policy.save_failed"), {
      locale,
      overrides: {
        "invalid-argument": t("platform.policy.save_invalid"),
        precondition: t("platform.policy.save_conflict"),
      },
    }),
    ok: false,
  };
};

/**
 * Write one half of the policy row.
 *
 * `UpdatePlatformPolicy` writes the whole row, so the half this screen does not
 * edit is taken from a fresh read. `expectedRevision` is the revision the
 * screen was rendered at, not the one this read returns: if another operator
 * saved in between, the server refuses the write instead of letting either half
 * of this screen's stale copy replace theirs.
 */
const savePlatformPolicy = async (
  edit: (stored: PlatformPolicy) => PlatformPolicy,
  expectedRevision: bigint,
  locale: Locale
): Promise<SavePlatformSettingsRowResult> => {
  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    const t = await getMessagesFor(locale);
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const current = await apiClient.policy.getPlatformPolicy(
      {},
      buildSessionHeaders(sessionId)
    );
    const { community, security } = edit(toPlatformPolicy(current.policy));

    await apiClient.policy.updatePlatformPolicy(
      {
        expectedRevision,
        policy: {
          communityLimitDefaults: community,
          ...security,
        },
      },
      buildSessionHeaders(sessionId)
    );

    return { ok: true };
  } catch (error) {
    return saveFailure(error, locale);
  }
};

export const updatePlatformSecurityPolicy = (
  security: PlatformSecurityPolicy,
  expectedRevision: bigint,
  locale: Locale
): Promise<SavePlatformSettingsRowResult> =>
  savePlatformPolicy(
    (stored) => ({ community: stored.community, security }),
    expectedRevision,
    locale
  );

export const updatePlatformCommunityLimits = (
  community: PlatformCommunityLimits,
  expectedRevision: bigint,
  locale: Locale
): Promise<SavePlatformSettingsRowResult> =>
  savePlatformPolicy(
    (stored) => ({ community, security: stored.security }),
    expectedRevision,
    locale
  );

export const updatePlatformRetentionDefaults = async (
  defaults: PlatformRetentionDefaults,
  expectedRevision: bigint,
  locale: Locale
): Promise<SavePlatformSettingsRowResult> => {
  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    const t = await getMessagesFor(locale);
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    await apiClient.policy.updatePlatformRetentionDefaults(
      {
        defaults: {
          contentEventDays: defaults.contentEventDays,
          dailyRankingSnapshotDays: defaults.dailyRankingSnapshotDays,
          weeklyRankingSnapshotDays: defaults.weeklyRankingSnapshotDays,
          withdrawnCommentDays: defaults.withdrawnCommentDays,
        },
        expectedRevision,
      },
      buildSessionHeaders(sessionId)
    );

    return { ok: true };
  } catch (error) {
    return saveFailure(error, locale);
  }
};
