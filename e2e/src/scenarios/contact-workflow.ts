/**
 * Records created by `db/seeds/scenarios/390_contact_workflow.sql`.
 *
 * The suite moves messages between two tenant admins and writes notes on them,
 * so the scenario is re-applied around it: it deletes the tenant and writes it
 * again, which puts every message back in the state it starts from.
 */

export const CONTACT_WORKFLOW_SCENARIO = "390_contact_workflow";

/** The tenant whose inbox the two members of staff share. */
export const CONTACT_WORKFLOW_TENANT = {
  /** The tenant's primary key, which the public API's `TenantContext` takes. */
  id: "018f1070-0001-7000-8000-000000000001",
  publicId: "DeskTNNTAAA1",
} as const;

/** The tenant admin the suite signs in as first. Password hash is `adminpass`. */
export const CONTACT_WORKFLOW_ADMIN = {
  email: "desk-admin@example.com",
  name: "Desk E2E Admin",
  password: "adminpass",
  publicId: "DeskADMNAAA1",
} as const;

/** A second tenant admin, the colleague messages are handed to. */
export const CONTACT_WORKFLOW_COLLEAGUE = {
  email: "desk-colleague@example.com",
  name: "Desk E2E Colleague",
  password: "adminpass",
  publicId: "DeskADMNAAA2",
} as const;

/** A tenant editor, who cannot open the inbox and so is never an assignee. */
export const CONTACT_WORKFLOW_EDITOR = {
  name: "Desk E2E Editor",
  publicId: "DeskEDTRAAA1",
} as const;

/** Unhandled and unassigned: the message the suite walks through the workflow. */
export const CONTACT_WORKFLOW_UNHANDLED = {
  publicId: "DeskMSGAAAA1",
  subject: "The second episode will not open",
} as const;

/** In progress, assigned to the colleague, with a note staff keep on it. */
export const CONTACT_WORKFLOW_IN_PROGRESS = {
  publicId: "DeskMSGAAAA2",
  replyToEmail: "desk-reader-two@example.com",
  staffNote: "Internal: the misspelling is fixed in the next printing.",
  subject: "A typo on the third page",
} as const;

/**
 * Handled by the colleague while still assigned to the admin, so the inbox has
 * to name the assignee rather than whoever marked it handled.
 */
export const CONTACT_WORKFLOW_HANDLED = {
  publicId: "DeskMSGAAAA3",
  subject: "Thank you for the new series",
} as const;
