/**
 * Records of the Platform Console's audit log download E2E scenario.
 */

export const PLATFORM_AUDIT_LOG_EXPORT_SCENARIO =
  "720_platform_audit_log_export";

/** The Auditor the suite downloads as. */
export const PLATFORM_AUDIT_LOG_EXPORT_AUDITOR = {
  email: "audit-export-auditor@example.com",
  name: "Export E2E Auditor",
  password: "platformpass",
  publicId: "AxptPFUSAAA1",
} as const;

/** The Operator whose entries the downloaded week holds. */
export const PLATFORM_AUDIT_LOG_EXPORT_OPERATOR = {
  name: "Export E2E Operator",
  publicId: "AxptPFUSAAA2",
} as const;

/**
 * The week the file covers, in the platform's default time zone, and the
 * Operator's entries in it, oldest first. One more entry lies just outside it
 * at each end.
 */
export const PLATFORM_AUDIT_LOG_EXPORT_WEEK = {
  actions: ["operator_updated", "operator_suspended", "operator_resumed"],
  from: "2025-03-03",
  to: "2025-03-09",
} as const;
