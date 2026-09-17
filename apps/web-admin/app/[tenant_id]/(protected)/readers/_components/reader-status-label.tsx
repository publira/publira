import type { Locale } from "@publira/i18n";
import type { BadgeTone } from "@publira/ui-components/badge";

import { Message } from "#components/message";
import { getMessagesFor } from "#lib/messages";

import type { ReaderStatus } from "../reader-types";

/** The name one account state goes by, with the key spelled out per branch. */
export const ReaderStatusMessage = ({ status }: { status: ReaderStatus }) => {
  switch (status) {
    case "active": {
      return <Message message="admin.readers.status_active" />;
    }
    case "suspended": {
      return <Message message="admin.readers.status_suspended" />;
    }
    default: {
      return <Message message="admin.readers.status_inactive" />;
    }
  }
};

/** The same name as a string, for the `<option>` labels of the status filter. */
export const readerStatusLabel = async (
  status: ReaderStatus,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);
  switch (status) {
    case "active": {
      return t("admin.readers.status_active");
    }
    case "suspended": {
      return t("admin.readers.status_suspended");
    }
    default: {
      return t("admin.readers.status_inactive");
    }
  }
};

export const readerStatusTone = (status: ReaderStatus): BadgeTone => {
  switch (status) {
    case "active": {
      return "success";
    }
    case "suspended": {
      return "destructive";
    }
    default: {
      return "muted";
    }
  }
};
