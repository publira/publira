/**
 * Records created by `db/seeds/scenarios/470_docs_platform.sql`, which the
 * Platform Console's documentation screenshots photograph.
 *
 * `tests/admin.docs-screenshots.setup.ts` applies the file once, before any
 * shot is taken; nothing else reads these rows.
 */

/** The tenant whose staff, readers, invitations, and audit log are shown. */
export const DOCS_PLATFORM_TENANT = {
  name: "Platform Docs Tenant",
  publicId: "PdocTNNTAAA1",
} as const;

/** A tenant that is suspended, for the screen that resumes one. */
export const DOCS_PLATFORM_SUSPENDED_TENANT = {
  name: "Suspended Docs Tenant",
  publicId: "PdocTNNTAAA2",
} as const;

/** A reader of {@link DOCS_PLATFORM_TENANT} who can be suspended or deleted. */
export const DOCS_PLATFORM_READER = {
  name: "Docs Reader",
  publicId: "PdocMMBRAAA1",
} as const;

/** A reader of {@link DOCS_PLATFORM_TENANT} who is suspended. */
export const DOCS_PLATFORM_SUSPENDED_READER = {
  name: "Docs Suspended Reader",
  publicId: "PdocMMBRAAA2",
} as const;

/**
 * An Operator, the one the notification that an episode could not be
 * published is addressed to. Password hash is `platformpass`.
 */
export const DOCS_PLATFORM_OPERATOR = {
  email: "docs-operator@example.com",
  name: "Docs Operator",
  password: "platformpass",
  publicId: "PdocPFUSAAA1",
} as const;

/** An Auditor, whose page a Super admin can change the role of. */
export const DOCS_PLATFORM_AUDITOR = {
  name: "Docs Platform Auditor",
  publicId: "PdocPFUSAAA2",
} as const;
