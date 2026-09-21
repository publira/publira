import type {
  RetentionPeriods,
  TenantRetentionOverrides as TenantRetentionOverridesMessage,
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
import { getAccessToken } from "./session";

/** How long each kind of record is kept, in whole days. */
export interface TenantRetentionPeriods {
  contentEventDays: number;
  dailyRankingSnapshotDays: number;
  weeklyRankingSnapshotDays: number;
  withdrawnCommentDays: number;
}

/** What the tenant has saved. An absent field follows the platform default. */
export type TenantRetentionOverrides = Partial<TenantRetentionPeriods>;

export interface TenantRetentionSettings {
  overrides: TenantRetentionOverrides;
  platformDefaults: TenantRetentionPeriods;
  /** Decimal int64 the screen sends back with its save; `"0"` means nothing saved yet. */
  revision: string;
}

export type GetTenantRetentionSettingsResult =
  | ({ ok: true } & TenantRetentionSettings)
  | {
      ok: false;
      message: string;
      /** No periods: a failed read has nothing the screen could offer for editing. */
      requiresSignIn: boolean;
    };

export type UpdateTenantRetentionSettingsResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Tag the screen's cached read carries, so `updateTag` in the Server Action
 * shows the saved periods and their new revision in the same session.
 */
export const tenantRetentionSettingsCacheTag = (tenantId: string): string =>
  `tenant:${tenantId.trim()}:retention-settings`;

type RawRetentionPeriods = Pick<
  RetentionPeriods,
  | "contentEventDays"
  | "dailyRankingSnapshotDays"
  | "weeklyRankingSnapshotDays"
  | "withdrawnCommentDays"
>;

type RawTenantRetentionOverrides = Pick<
  TenantRetentionOverridesMessage,
  | "contentEventDays"
  | "dailyRankingSnapshotDays"
  | "weeklyRankingSnapshotDays"
  | "withdrawnCommentDays"
>;

const toRetentionPeriods = (
  periods: RawRetentionPeriods | undefined
): TenantRetentionPeriods => ({
  contentEventDays: periods?.contentEventDays ?? 0,
  dailyRankingSnapshotDays: periods?.dailyRankingSnapshotDays ?? 0,
  weeklyRankingSnapshotDays: periods?.weeklyRankingSnapshotDays ?? 0,
  withdrawnCommentDays: periods?.withdrawnCommentDays ?? 0,
});

const toRetentionOverrides = (
  overrides: RawTenantRetentionOverrides | undefined
): TenantRetentionOverrides => ({
  contentEventDays: overrides?.contentEventDays,
  dailyRankingSnapshotDays: overrides?.dailyRankingSnapshotDays,
  weeklyRankingSnapshotDays: overrides?.weeklyRankingSnapshotDays,
  withdrawnCommentDays: overrides?.withdrawnCommentDays,
});

export const getTenantRetentionSettings = async (
  tenantId: string,
  locale: Locale
): Promise<GetTenantRetentionSettingsResult> => {
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

  cacheTag(tenantRetentionSettingsCacheTag(normalizedTenantId));

  try {
    const response = await apiClient.tenantSettings.getTenantRetentionSettings(
      { tenant: { tenantId: normalizedTenantId } },
      withSessionHeaders(sessionId)
    );

    return {
      ok: true,
      overrides: toRetentionOverrides(response.overrides),
      platformDefaults: toRetentionPeriods(response.platformDefaults),
      revision: String(response.revision),
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.policy.retention.load_failed"),
        { locale }
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

export const updateTenantRetentionSettings = async (
  input: {
    expectedRevision: bigint;
    overrides: TenantRetentionOverrides;
    tenantId: string;
  },
  locale: Locale
): Promise<UpdateTenantRetentionSettingsResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  const normalizedTenantId = input.tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    await apiClient.tenantSettings.updateTenantRetentionSettings(
      {
        expectedRevision: input.expectedRevision,
        // Every field is written: one left out clears that override.
        overrides: {
          contentEventDays: input.overrides.contentEventDays,
          dailyRankingSnapshotDays: input.overrides.dailyRankingSnapshotDays,
          weeklyRankingSnapshotDays: input.overrides.weeklyRankingSnapshotDays,
          withdrawnCommentDays: input.overrides.withdrawnCommentDays,
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
        t("admin.settings.policy.retention.save_failed"),
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
