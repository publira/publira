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
  if (status === "handled") {
    return <Message message="admin.contact_messages.status_handled" />;
  }

  return <Message message="admin.contact_messages.status_unhandled" />;
};

/** The same name as a string, for the `<option>` labels of the status filter. */
export const contactMessageStatusLabel = async (
  status: ContactMessageStatus,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);
  if (status === "handled") {
    return t("admin.contact_messages.status_handled");
  }

  return t("admin.contact_messages.status_unhandled");
};

/**
 * A message still waiting reads as outstanding work rather than as a fault, so
 * it takes the warning tone and a handled one the success tone.
 */
export const contactMessageStatusTone = (
  status: ContactMessageStatus
): BadgeTone => (status === "handled" ? "success" : "warning");
