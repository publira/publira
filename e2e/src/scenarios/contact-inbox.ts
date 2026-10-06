/**
 * Records created by `db/seeds/scenarios/220_contact_inbox.sql`.
 *
 * The suite marks one of these messages handled and puts it back, and answers
 * another, so the scenario is re-applied around it to restore the state it
 * starts from.
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

/**
 * The message staff have already dealt with, answered by the seed admin and
 * replied to by the guest from another address than the one on the message.
 */
export const CONTACT_INBOX_HANDLED = {
  answer: "Thank you for reading it. The next chapter is out on Friday.",
  publicId: "CtctMSGAAAA3",
  reply: "I will be waiting for it.",
  replyFromEmail: "contact-inbox-answered.home@example.com",
  replyToEmail: "contact-inbox-answered@example.com",
  subject: "Thank you for the new series",
} as const;
