/**
 * Records created by `db/seeds/scenarios/690_admin_analytics.sql`, and what
 * the analytics screens show for them. Re-applying it deletes the tenant and
 * writes it again.
 */
export const ADMIN_ANALYTICS_SCENARIO = "690_admin_analytics";

export const ANALYTICS_TENANT = { publicId: "AnlyTNNTAAA1" } as const;

/** Tenant admin of the tenant. Password hash is the same as `adminpass`. */
export const ANALYTICS_ADMIN = {
  email: "analytics-admin@example.com",
  name: "Analytics Admin",
  password: "adminpass",
  publicId: "AnlyADMNAAA1",
} as const;

/** The week every figure below is counted over, in the tenant's UTC days. */
export const ANALYTICS_WEEK = {
  days: 7,
  from: "2025-03-03",
  to: "2025-03-09",
} as const;

export const ANALYTICS_SERIES = {
  first: { publicId: "AnlySERSAAA1", title: "Analytics Series 01" },
  second: { publicId: "AnlySERSAAA2", title: "Analytics Series 02" },
} as const;

export const ANALYTICS_EPISODES = {
  first: { publicId: "AnlyEPSDAAA1", title: "Analytics Episode 01-01" },
  second: { publicId: "AnlyEPSDAAA2", title: "Analytics Episode 01-02" },
  third: { publicId: "AnlyEPSDAAA3", title: "Analytics Episode 02-01" },
} as const;

/** Revenue over the week, in yen. A sale the day after it is left out. */
export const ANALYTICS_REVENUE = {
  gross: "¥2,350",
  net: "¥1,850",
  purchases: "7",
  refunded: "¥500",
  /** Net per series, the highest first, and in the CSV's minor unit. */
  series: [
    {
      net: "¥1,100",
      netAmount: "1100",
      publicId: "AnlySERSAAA1",
      purchases: "4",
      title: "Analytics Series 01",
    },
    {
      net: "¥750",
      netAmount: "750",
      publicId: "AnlySERSAAA2",
      purchases: "3",
      title: "Analytics Series 02",
    },
  ],
} as const;

/** The audience over the week. */
export const ANALYTICS_AUDIENCE = {
  completions: "40",
  followers: "4",
  reactions: "16",
  /** Followers at the end of the week, the most first. */
  series: [
    {
      followed: "2",
      followers: "3",
      title: "Analytics Series 01",
      unfollowed: "0",
      views: "120",
    },
    {
      followed: "2",
      followers: "1",
      title: "Analytics Series 02",
      unfollowed: "1",
      views: "80",
    },
  ],
  views: "200",
} as const;

/** The drop-off of `Analytics Episode 01-01` over the week. */
export const ANALYTICS_DROP_OFF = {
  lastPageReaders: "4",
  pageCount: "4",
  /** Each page from the first: readers who reached it, and who left at it. */
  pages: [
    { left: "2", page: "Page 1", readers: "13", share: "100.0%" },
    { left: "6", page: "Page 2", readers: "11", share: "84.6%" },
    { left: "1", page: "Page 3", readers: "5", share: "38.5%" },
    { left: "4", page: "Page 4", readers: "4", share: "30.8%" },
  ],
  readers: "13",
} as const;
