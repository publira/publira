import type { SeriesWaitFreeSettings as RpcSeriesWaitFreeSettings } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorHasFieldViolation,
} from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheLife, cacheTag } from "next/cache";

import { rethrowUnauthenticatedRpcError } from "./admin-auth-shared";
import { verifyAdminPageSession } from "./admin-page-session";
import { apiClient, withServiceHeaders, withSessionHeaders } from "./api";
import { getMessagesFor } from "./messages";
import { MAX_WAIT_FREE_HOURS } from "./series-wait-free-shared";
import type { SeriesWaitFreeSettings } from "./series-wait-free-shared";
import { getAccessToken } from "./session";

export type SeriesWaitFreeSettingsResult =
  | { ok: true; settings: SeriesWaitFreeSettings }
  | { ok: false; message: string };

/**
 * The tag one series' rule is read under. The Action that saves it clears it,
 * which is what carries the save back to the series screen.
 */
export const seriesWaitFreeSettingsCacheTag = (
  tenantId: string,
  seriesId: string
): string => `series-wait-free-${tenantId}-${seriesId}`;

/** The generated fields {@link toSeriesWaitFreeSettings} reads (see `series.ts`). */
type RawSeriesWaitFreeSettings = Pick<
  RpcSeriesWaitFreeSettings,
  "accessHours" | "enabled" | "excludedLatestCount" | "rechargeHours"
>;

/**
 * The API answers its defaults for a series nobody configured, so a period of
 * zero hours is a read that said nothing rather than the series' rule: the form
 * would open on it, and the next save would be refused or would write it.
 */
const toSeriesWaitFreeSettings = (
  settings: RawSeriesWaitFreeSettings | undefined
): SeriesWaitFreeSettings | undefined => {
  if (!settings || settings.rechargeHours < 1 || settings.accessHours < 1) {
    return;
  }
  return {
    accessHours: settings.accessHours,
    enabled: settings.enabled,
    excludedLatestCount: settings.excludedLatestCount,
    rechargeHours: settings.rechargeHours,
  };
};

/**
 * The wording for a refused save. The field violations are the bounds the form
 * already checks, reached only when the two disagree.
 */
const mapUpdateErrorToMessage = async (
  error: unknown,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);
  if (rpcErrorHasFieldViolation(error, "settings.recharge_hours")) {
    return t("admin.series.wait_free.validation.recharge_hours_invalid", {
      max: String(MAX_WAIT_FREE_HOURS),
    });
  }
  if (rpcErrorHasFieldViolation(error, "settings.access_hours")) {
    return t("admin.series.wait_free.validation.access_hours_invalid", {
      max: String(MAX_WAIT_FREE_HOURS),
    });
  }
  if (rpcErrorHasFieldViolation(error, "settings.excluded_latest_count")) {
    return t("admin.series.wait_free.validation.excluded_latest_count_invalid");
  }

  return rpcErrorMessage(error, t("admin.series.wait_free.save_failed"), {
    locale,
    overrides: { "not-found": t("admin.series.not_found") },
  });
};

const getSeriesWaitFreeSettingsForTenant = async (
  input: { seriesId: string; tenantId: string },
  locale: Locale
): Promise<SeriesWaitFreeSettingsResult> => {
  "use cache";
  // The rule can be saved through the Admin API without this app, and publira
  // server revalidates only the storefront's tags when it is, so the entry is
  // refetched once it is a minute old rather than kept for the default quarter
  // of an hour.
  cacheLife("minutes");
  cacheTag(seriesWaitFreeSettingsCacheTag(input.tenantId, input.seriesId));

  const t = await getMessagesFor(locale);
  try {
    const response = await apiClient.series.getSeriesWaitFreeSettings(
      { seriesId: input.seriesId, tenant: { tenantId: input.tenantId } },
      withServiceHeaders()
    );
    const settings = toSeriesWaitFreeSettings(response.settings);
    if (!settings) {
      dropFailedCacheEntry();
      return { message: t("admin.series.wait_free.load_failed"), ok: false };
    }

    return { ok: true, settings };
  } catch (error) {
    // A `"use cache"` scope cannot rethrow: the fill would fail the whole
    // request. The entry is dropped instead, so the answer comes back as soon
    // as the API does.
    dropFailedCacheEntry();
    return {
      message: rpcErrorMessage(error, t("admin.series.wait_free.load_failed"), {
        locale,
        overrides: { "not-found": t("admin.series.not_found") },
      }),
      ok: false,
    };
  }
};

/**
 * One series' wait-for-free rule, the API's defaults for a series nobody has
 * configured.
 *
 * Read with the service credential: the rule is the same for every operator
 * of the tenant, so one entry serves all of them.
 */
export const getSeriesWaitFreeSettings = async (input: {
  seriesId: string;
}): Promise<SeriesWaitFreeSettingsResult> => {
  const { locale, tenantId } = await verifyAdminPageSession();
  return getSeriesWaitFreeSettingsForTenant({ ...input, tenantId }, locale);
};

/** Saves the whole rule, and answers it as the API stored it. */
export const updateSeriesWaitFreeSettings = async (
  input: { tenantId: string; seriesId: string } & SeriesWaitFreeSettings,
  locale: Locale
): Promise<SeriesWaitFreeSettingsResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.series.updateSeriesWaitFreeSettings(
      {
        seriesId: input.seriesId,
        settings: {
          accessHours: input.accessHours,
          enabled: input.enabled,
          excludedLatestCount: input.excludedLatestCount,
          rechargeHours: input.rechargeHours,
        },
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );
    const settings = toSeriesWaitFreeSettings(response.settings);
    if (!settings) {
      return { message: t("admin.series.wait_free.save_failed"), ok: false };
    }

    return { ok: true, settings };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return { message: await mapUpdateErrorToMessage(error, locale), ok: false };
  }
};
