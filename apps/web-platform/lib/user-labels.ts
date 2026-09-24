import type { Locale } from "@publira/i18n";

import type { PlatformMessageKey } from "./locale";
import { getMessagesFor } from "./messages";

export type EndUserStatusTone = "destructive" | "info" | "success";

const accountStatusKeys = new Map<string, PlatformMessageKey>([
  ["active", "platform.common.account_status.active"],
  ["inactive", "platform.common.account_status.inactive"],
  ["suspended", "platform.common.account_status.suspended"],
]);

/**
 * `locale` rather than a resolved accessor, so this reads the catalog itself:
 * the label is the only thing the caller wants, and handing a function across
 * the boundary would make the key an attribute of whatever the caller bound.
 */
export const getEndUserStatusLabel = async (
  status: string,
  locale: Locale
): Promise<string> => {
  const key = accountStatusKeys.get(status);
  if (!key) {
    return status;
  }

  const t = await getMessagesFor(locale);

  return t(key);
};

export const getEndUserStatusTone = (status: string): EndUserStatusTone => {
  switch (status) {
    case "active": {
      return "success";
    }
    case "suspended": {
      return "destructive";
    }
    default: {
      return "info";
    }
  }
};
