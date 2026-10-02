import type { Locale } from "@publira/i18n";
import type { BadgeTone } from "@publira/ui-components/badge";

import { Message } from "#components/message";
import { getMessagesFor } from "#lib/messages";

import type { ContactMessageStatus } from "../contact-message-types";

/** The name one state goes by, with the key spelled out per branch. */
export const ContactMessageStatusMessage = ({
  status,
}: {
  status: ContactMessageStatus;
}) => {
  switch (status) {
    case "handled": {
      return <Message message="admin.contact_messages.status_handled" />;
    }
    case "in_progress": {
      return <Message message="admin.contact_messages.status_in_progress" />;
    }
    default: {
      return <Message message="admin.contact_messages.status_unhandled" />;
    }
  }
};

/** The same name as a string, for the `<option>` labels of the status filter. */
export const contactMessageStatusLabel = async (
  status: ContactMessageStatus,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);
  switch (status) {
    case "handled": {
      return t("admin.contact_messages.status_handled");
    }
    case "in_progress": {
      return t("admin.contact_messages.status_in_progress");
    }
    default: {
      return t("admin.contact_messages.status_unhandled");
    }
  }
};

/**
 * A message nobody has picked up reads as outstanding work rather than as a
 * fault, so it takes the warning tone; one somebody is working on is only
 * information, and a handled one takes the success tone.
 */
export const contactMessageStatusTone = (
  status: ContactMessageStatus
): BadgeTone => {
  switch (status) {
    case "handled": {
      return "success";
    }
    case "in_progress": {
      return "info";
    }
    default: {
      return "warning";
    }
  }
};
