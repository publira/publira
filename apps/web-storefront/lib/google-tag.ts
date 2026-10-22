import { isExpectedNullableRpcError } from "@publira/api-client/errors";
import { GoogleTagServingMode } from "@publira/api-client/public/types";
import type { TenantGoogleTag } from "@publira/api-client/public/types";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheLife } from "next/cache";

import { apiClient } from "./api-client";
import { applyCacheTag, tenantAnalyticsSettingsTag } from "./cache-tags";
import type { GoogleTagServing, GoogleTagSettings } from "./google-tag-scripts";

type RawTenantGoogleTag = Pick<
  TenantGoogleTag,
  | "ga4MeasurementId"
  | "gatewayPath"
  | "gtmContainerId"
  | "serverContainerUrl"
  | "servingMode"
>;

/**
 * A mode this build does not know, or one missing the value it needs, answers
 * `null`: the tag is not loaded from Google in its place, since that sends
 * readers' data to an origin the tenant did not choose.
 */
const toServing = (tag: RawTenantGoogleTag): GoogleTagServing | null => {
  switch (tag.servingMode) {
    case GoogleTagServingMode.GOOGLE: {
      return { mode: "google" };
    }
    case GoogleTagServingMode.SERVER_CONTAINER: {
      const serverContainerUrl = tag.serverContainerUrl?.trim() ?? "";
      return serverContainerUrl
        ? { mode: "server_container", serverContainerUrl }
        : null;
    }
    case GoogleTagServingMode.GATEWAY: {
      const gatewayPath = tag.gatewayPath?.trim() ?? "";
      return gatewayPath ? { gatewayPath, mode: "gateway" } : null;
    }
    default: {
      return null;
    }
  }
};

export const toGoogleTagSettings = (
  tag: RawTenantGoogleTag | undefined
): GoogleTagSettings | null => {
  if (!tag) {
    return null;
  }
  const ga4MeasurementId = tag.ga4MeasurementId?.trim() ?? "";
  const gtmContainerId = tag.gtmContainerId?.trim() ?? "";
  const serving = toServing(tag);
  if (!(ga4MeasurementId || gtmContainerId) || !serving) {
    return null;
  }
  return { ga4MeasurementId, gtmContainerId, serving };
};

/**
 * The Google tag the tenant's pages load, or `null` for none.
 *
 * Every page reads it, so it is one shared entry per tenant under
 * `tenant:<id>:analytics-settings`, which the console's save drops.
 *
 * An unavailable read loads no tag, and the entry is dropped so the tag comes
 * back with the API: a missed page view is the cheaper failure than a page
 * that fails over its own measurement.
 */
export const getTenantGoogleTag = async (
  tenantId: string
): Promise<GoogleTagSettings | null> => {
  "use cache";
  cacheLife({ stale: 30 });

  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId) {
    return null;
  }

  applyCacheTag(tenantAnalyticsSettingsTag(normalizedTenantId));

  try {
    const response = await apiClient.tenant.getTenantAnalyticsSettings({
      tenant: { tenantId: normalizedTenantId },
    });
    return toGoogleTagSettings(response.googleTag);
  } catch (error) {
    if (!isExpectedNullableRpcError(error)) {
      console.warn("[web-storefront] getTenantGoogleTag failed", error);
      dropFailedCacheEntry();
    }
    return null;
  }
};
