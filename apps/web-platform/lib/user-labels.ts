import type { Locale } from "@publira/i18n";

import { getMessagesFor } from "./messages";

export type EndUserStatusTone = "destructive" | "info" | "success";

/**
 * `locale` rather than a resolved accessor, so this reads the catalog itself:
 * the label is the only thing the caller wants, and handing a function across
 * the boundary would make the key an attribute of whatever the caller bound.
 */
export const getEndUserStatusLabel = async (
  status: string,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);

  switch (status) {
    case "active": {
      return t("platform.common.account_status.active");
    }
    case "inactive": {
      return t("platform.common.account_status.inactive");
    }
    case "suspended": {
      return t("platform.common.account_status.suspended");
    }
    default: {
      return status;
    }
  }
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
