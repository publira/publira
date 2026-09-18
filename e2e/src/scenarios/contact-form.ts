/**
 * Records created by `db/seeds/scenarios/230_contact_form.sql`.
 *
 * Re-applying the scenario deletes every message sent to either address below,
 * which is what the suite does before and after itself.
 */

export const CONTACT_FORM_SCENARIO = "230_contact_form";

/** A reader of the dev seed tenant with a stored date of birth. */
export const CONTACT_FORM_MEMBER = {
  email: "contact-form-member@example.com",
  name: "Contact Form Member",
  password: "memberpass",
  publicId: "CfrmMMBRAAA1",
} as const;

/** The address the guest's message is sent from. */
export const CONTACT_FORM_GUEST_EMAIL = "contact-form-guest@example.com";
