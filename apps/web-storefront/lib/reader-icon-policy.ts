import { isExpectedNullableRpcError } from "@publira/api-client/errors";
import { ReaderIconPolicy } from "@publira/api-client/public/types";
import type { ReaderIconPreset } from "@publira/api-client/public/types";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheLife } from "next/cache";

import { toAccountIcon } from "./account-icon";
import { apiClient } from "./api-client";
import type { AccountIcon } from "./auth";
import { applyCacheTag, tenantSiteTag } from "./cache-tags";

/** An icon the tenant offers its readers to pick. */
export interface ReaderIconPresetOption {
  icon: AccountIcon;
  /** What `AuthService.SelectMyIcon` is sent to show this preset. */
  id: string;
}

/**
 * What a reader of the tenant may show as an icon, in the site's own words:
 * an image of their own, one of the tenant's presets, or none.
 */
export type TenantReaderIconChoice =
  | { kind: "disabled" }
  | { kind: "preset"; presets: readonly ReaderIconPresetOption[] }
  | { kind: "upload" };

const toPresetOptions = (
  presets: readonly ReaderIconPreset[]
): ReaderIconPresetOption[] =>
  presets.flatMap((preset) => {
    const icon = toAccountIcon(preset.variants);
    return icon ? [{ icon, id: preset.id }] : [];
  });

/**
 * The tenant's reader icon policy, which decides the icon field the settings
 * screen offers.
 *
 * The read carries `tenant:<id>:site`, which the API drops when the policy or a
 * preset changes, so a saved change reaches the screen without waiting for the
 * cache to age out.
 *
 * An unavailable read, and a policy this build does not know, answer
 * `disabled`: the field that offers nothing is the only one whose every
 * control the API is sure to accept.
 */
export const getTenantReaderIconChoice = async (
  tenantId: string
): Promise<TenantReaderIconChoice> => {
  "use cache";
  cacheLife({ stale: 30 });

  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId) {
    return { kind: "disabled" };
  }

  applyCacheTag(tenantSiteTag(normalizedTenantId));

  try {
    const response = await apiClient.tenant.getTenantReaderIconPolicy({
      tenant: { tenantId: normalizedTenantId },
    });
    switch (response.policy) {
      case ReaderIconPolicy.UPLOAD: {
        return { kind: "upload" };
      }
      case ReaderIconPolicy.PRESET: {
        return { kind: "preset", presets: toPresetOptions(response.presets) };
      }
      default: {
        return { kind: "disabled" };
      }
    }
  } catch (error) {
    if (!isExpectedNullableRpcError(error)) {
      console.warn("[web-storefront] getTenantReaderIconChoice failed", error);
      dropFailedCacheEntry();
    }
    return { kind: "disabled" };
  }
};

/**
 * Whether the settings screen has an icon field to offer: a tenant that allows
 * no icon gets none, and neither does one that offers presets but has none yet,
 * to an account that shows no icon to remove.
 */
export const offersReaderIconField = (
  choice: TenantReaderIconChoice,
  hasIcon: boolean
): choice is Exclude<TenantReaderIconChoice, { kind: "disabled" }> => {
  switch (choice.kind) {
    case "disabled": {
      return false;
    }
    case "preset": {
      return choice.presets.length > 0 || hasIcon;
    }
    default: {
      return true;
    }
  }
};
