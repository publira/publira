/**
 * Records created by `db/seeds/scenarios/220_contact_inbox.sql`.
 *
 * The suite marks one of these messages handled and puts it back, so the
 * scenario is re-applied around it to restore the state it starts from.
 */

export const CONTACT_INBOX_SCENARIO = "220_contact_inbox";

/** The message a signed-in reader sent, which the suite opens and marks. */
export const CONTACT_INBOX_FROM_READER = {
  publicId: "CtctMSGAAAA1",
  replyToEmail: "contact-inbox-reader@example.com",
  senderName: "Sample Member",
  subject: "Cannot open an episode",
} as const;

/** The message a guest sent without a subject. */
export const CONTACT_INBOX_FROM_GUEST = {
  publicId: "CtctMSGAAAA2",
  replyToEmail: "contact-inbox-guest@example.com",
} as const;

/** The message staff have already dealt with. */
export const CONTACT_INBOX_HANDLED = {
  publicId: "CtctMSGAAAA3",
  replyToEmail: "contact-inbox-answered@example.com",
  subject: "Thank you for the new series",
} as const;
