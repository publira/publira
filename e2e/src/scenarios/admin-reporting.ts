/**
 * Records created by `db/seeds/scenarios/120_admin_reporting.sql`.
 *
 * The file builds on `010_multi_tenant.sql`: the Boundary Tenant it gives an
 * admin and audit entries to comes from there, so apply that one first.
 */
export const ADMIN_REPORTING_SCENARIO = "120_admin_reporting";

/**
 * The development seed tenant's audit entries, `rpt-audit-001` through
 * `rpt-audit-045`, dated 2026-01-05 through 2026-01-13 at five per day.
 */
export const REPORTING_AUDIT = {
  count: 45,
  /** `from` / `to` values that select every entry and nothing else. */
  from: "2026-01-05",
  labelUpdatedCount: 9,
  /** Every ninth entry was the member's, and failed. */
  memberTargetIds: [
    "rpt-audit-045",
    "rpt-audit-036",
    "rpt-audit-027",
    "rpt-audit-018",
    "rpt-audit-009",
  ] as const,
  newestTargetId: "rpt-audit-045",
  oldestTargetId: "rpt-audit-001",
  /** A single day inside the range and the entries dated on it. */
  singleDay: "2026-01-10",
  /** That day's entries the admin made: all but the member's `rpt-audit-027`. */
  singleDayAdminTargetIds: [
    "rpt-audit-030",
    "rpt-audit-029",
    "rpt-audit-028",
    "rpt-audit-026",
  ] as const,
  /** The one `label_updated` entry on that day. */
  singleDayLabelUpdatedTargetId: "rpt-audit-028",
  singleDayTargetIds: [
    "rpt-audit-030",
    "rpt-audit-029",
    "rpt-audit-028",
    "rpt-audit-027",
    "rpt-audit-026",
  ] as const,
  to: "2026-01-13",
} as const;

/** Tenant admin of the Boundary Tenant. Password hash is the same as `adminpass`. */
export const BOUNDARY_ADMIN = {
  email: "boundary-admin@example.com",
  name: "Boundary Admin",
  password: "adminpass",
  publicId: "BndrADMNAAA1",
} as const;

/** The Boundary Tenant's audit entries, all on 2026-01-10. */
export const BOUNDARY_AUDIT = {
  count: 3,
  targetIdPrefix: "rpt-boundary-",
} as const;

/**
 * What the read-through report shows for the development seed tenant once the
 * scenario's `content_daily_stats` rows are in place.
 */
export const REPORTING_READ_THROUGH = {
  /** The Boundary Tenant's episode with in-window rows of its own. */
  boundaryEpisodeTitle: "Boundary Episode 001-01",
  episodeCount: 25,
  /** Listed highest completion count first. */
  firstPage: {
    first: {
      completeCount: 60,
      episodeTitle: "Seed Episode 001-01",
      memberViewCount: 120,
      rate: "50.0%",
      seriesTitle: "Seed Series 001",
    },
    last: {
      completeCount: 11,
      episodeTitle: "Seed Episode 002-09",
      memberViewCount: 22,
      rate: "50.0%",
    },
  },
  /** The only episode every member who opened it finished. */
  fullyRead: {
    completeCount: 40,
    episodeTitle: "Seed Episode 003-05",
    memberViewCount: 40,
    rate: "100.0%",
  },
  secondPage: {
    count: 5,
    first: {
      completeCount: 9,
      episodeTitle: "Seed Episode 002-10",
      memberViewCount: 18,
      rate: "50.0%",
    },
    /** Member views but no completion: a rate of zero, not an absent one. */
    last: {
      completeCount: 0,
      episodeTitle: "Seed Episode 003-04",
      memberViewCount: 40,
      rate: "0.0%",
    },
  },
  /** Every row inside the window, summed. */
  totalCompleteCount: 628,
  totalMemberViewCount: 1256,
  totalRate: "50.0%",
} as const;
