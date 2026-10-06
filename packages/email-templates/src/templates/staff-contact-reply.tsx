import type { Locale } from "@publira/i18n";
import { formatDateTime } from "@publira/utils";
import { z } from "zod";

import { EmailLayout } from "../layout";
import { emailMessage } from "../messages";
import type { Messages } from "../messages";
import "../temporal";
import { EmailDetail, EmailLetter, EmailMeta, EmailQuote } from "../text";
import {
  displayNameField,
  instantField,
  optionalSingleLineField,
  quotedTextField,
} from "./fields";

export const staffContactReplyDataSchema = z.object({
  /** The answer a member of staff wrote. */
  body: quotedTextField("body", 4000),
  /** The reader's own message, quoted under the answer. */
  original_body: quotedTextField("original_body", 4000),
  original_received_at: instantField("original_received_at"),
  /** Empty for a message the reader gave no subject. */
  original_subject: optionalSingleLineField("original_subject", 200),
  tenant_name: displayNameField("tenant_name"),
});

export type StaffContactReplyData = z.output<
  typeof staffContactReplyDataSchema
>;

export interface StaffContactReplyEmailProps {
  data: StaffContactReplyData;
  locale: Locale;
  messages: Messages;
  timeZone: string;
}

export const staffContactReplyPreview = (
  data: StaffContactReplyData,
  messages: Messages
): string =>
  emailMessage(messages, "email.staff_contact_reply.preview", {
    tenant_name: data.tenant_name,
  });

/**
 * The answer a member of staff sends a reader from the console. It reads as a
 * reply from a person: the answer opens the card with no heading over it, and
 * the reader's own message follows as a quotation, so a reader who wrote to
 * several places can tell which question this answers. The subject is not
 * rendered here; it is the reader's own with `Re:` in front.
 */
export const StaffContactReplyEmail = ({
  data,
  locale,
  messages,
  timeZone,
}: StaffContactReplyEmailProps) => (
  <EmailLayout
    brand={data.tenant_name}
    locale={locale}
    messages={messages}
    preview={staffContactReplyPreview(data, messages)}
  >
    <EmailLetter>{data.body}</EmailLetter>
    <EmailDetail>
      {emailMessage(messages, "email.staff_contact_reply.quote_intro", {
        received_at: formatDateTime(data.original_received_at, {
          locale,
          timeZone,
        }),
      })}
    </EmailDetail>
    <EmailQuote>{data.original_body}</EmailQuote>
    <EmailMeta>
      {emailMessage(messages, "email.staff_contact_reply.footnote")}
    </EmailMeta>
  </EmailLayout>
);
