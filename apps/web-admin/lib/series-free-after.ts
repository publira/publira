import type { SeriesFreeAfterSettings as RpcSeriesFreeAfterSettings } from "@publira/api-client/admin/types";
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
import { MAX_FREE_AFTER_DAYS } from "./series-free-after-shared";
import type { SeriesFreeAfterSettings } from "./series-free-after-shared";
import { getAccessToken } from "./session";

export type SeriesFreeAfterSettingsResult =
  | { ok: true; settings: SeriesFreeAfterSettings }
  | { ok: false; message: string };

/**
 * The tag one series' rule is read under. The Action that saves it clears it,
 * which is what carries the save back to the series screen.
 */
export const seriesFreeAfterSettingsCacheTag = (
  tenantId: string,
  seriesId: string
): string => `series-free-after-${tenantId}-${seriesId}`;

/** The generated fields {@link toSeriesFreeAfterSettings} reads (see `series.ts`). */
type RawSeriesFreeAfterSettings = Pick<
  RpcSeriesFreeAfterSettings,
  "daysAfterPublication" | "enabled" | "excludedLatestCount"
>;

/**
 * The API answers its defaults for a series nobody configured, so a wait of
 * zero days is a read that said nothing rather than the series' rule: the form
 * would open on it, and the next save would be refused or would write it.
 */
const toSeriesFreeAfterSettings = (
  settings: RawSeriesFreeAfterSettings | undefined
): SeriesFreeAfterSettings | undefined => {
  if (!settings || settings.daysAfterPublication < 1) {
    return;
  }

  return {
    daysAfterPublication: settings.daysAfterPublication,
    enabled: settings.enabled,
    excludedLatestCount: settings.excludedLatestCount,
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

  if (rpcErrorHasFieldViolation(error, "settings.days_after_publication")) {
    return t(
      "admin.series.free_after.validation.days_after_publication_invalid",
      {
        max: String(MAX_FREE_AFTER_DAYS),
      }
    );
  }

  if (rpcErrorHasFieldViolation(error, "settings.excluded_latest_count")) {
    return t(
      "admin.series.free_after.validation.excluded_latest_count_invalid"
    );
  }

  return rpcErrorMessage(error, t("admin.series.free_after.save_failed"), {
    locale,
    overrides: { "not-found": t("admin.series.not_found") },
  });
};

const getSeriesFreeAfterSettingsForTenant = async (
  input: { seriesId: string; tenantId: string },
  locale: Locale
): Promise<SeriesFreeAfterSettingsResult> => {
  "use cache";
  // The rule can be saved through the Admin API without this app, and publira
  // server revalidates only the storefront's tags when it is, so the entry is
  // refetched once it is a minute old rather than kept for the default quarter
  // of an hour.
  cacheLife("minutes");
  cacheTag(seriesFreeAfterSettingsCacheTag(input.tenantId, input.seriesId));

  const t = await getMessagesFor(locale);

  try {
    const response = await apiClient.series.getSeriesFreeAfterSettings(
      { seriesId: input.seriesId, tenant: { tenantId: input.tenantId } },
      withServiceHeaders()
    );

    const settings = toSeriesFreeAfterSettings(response.settings);

    if (!settings) {
      dropFailedCacheEntry();

      return { message: t("admin.series.free_after.load_failed"), ok: false };
    }

    return { ok: true, settings };
  } catch (error) {
    // A `"use cache"` scope cannot rethrow: the fill would fail the whole
    // request. The entry is dropped instead, so the answer comes back as soon
    // as the API does.
    dropFailedCacheEntry();

    return {
      message: rpcErrorMessage(
        error,
        t("admin.series.free_after.load_failed"),
        {
          locale,
          overrides: { "not-found": t("admin.series.not_found") },
        }
      ),
      ok: false,
    };
  }
};

/**
 * One series' free-after-publication rule, the API's defaults for a series
 * nobody has configured.
 *
 * Read with the service credential: the rule is the same for every operator
 * of the tenant, so one entry serves all of them.
 */
export const getSeriesFreeAfterSettings = async (input: {
  seriesId: string;
}): Promise<SeriesFreeAfterSettingsResult> => {
  const { locale, tenantId } = await verifyAdminPageSession();

  return getSeriesFreeAfterSettingsForTenant({ ...input, tenantId }, locale);
};

/** Saves the whole rule, and answers it as the API stored it. */
export const updateSeriesFreeAfterSettings = async (
  input: { tenantId: string; seriesId: string } & SeriesFreeAfterSettings,
  locale: Locale
): Promise<SeriesFreeAfterSettingsResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.series.updateSeriesFreeAfterSettings(
      {
        seriesId: input.seriesId,
        settings: {
          daysAfterPublication: input.daysAfterPublication,
          enabled: input.enabled,
          excludedLatestCount: input.excludedLatestCount,
        },
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    const settings = toSeriesFreeAfterSettings(response.settings);

    if (!settings) {
      return { message: t("admin.series.free_after.save_failed"), ok: false };
    }

    return { ok: true, settings };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return { message: await mapUpdateErrorToMessage(error, locale), ok: false };
  }
};
