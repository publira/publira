import { getMessage } from "@publira/utils/i18n";

import type { PlatformMessageKey, PlatformMessages } from "./locale";

export type EndUserStatusTone = "destructive" | "info" | "success";

const accountStatusKeys = {
  active: "platform.common.account_status.active",
  inactive: "platform.common.account_status.inactive",
  suspended: "platform.common.account_status.suspended",
} as const satisfies Record<string, PlatformMessageKey>;

export const getEndUserStatusLabel = (
  status: string,
  messages: PlatformMessages
): string => {
  const key = accountStatusKeys[status];
  return key ? getMessage(messages, key) : status;
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
