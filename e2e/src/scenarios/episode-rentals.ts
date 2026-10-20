/**
 * Records created by `db/seeds/scenarios/550_episode_rentals.sql`. Re-applying
 * it deletes the tenant and writes it again, which takes the payment settings
 * the suite stores and the sales its readers paid for with it.
 *
 * The series takes 10% off the rest of it bought in one checkout.
 */

export const EPISODE_RENTALS_SCENARIO = "550_episode_rentals";

/** Tenant admin who takes the tenant's payments. Password hash is `adminpass`. */
export const EPISODE_RENTALS_ADMIN = {
  email: "rentals-admin@example.com",
  name: "Rentals E2E Admin",
  password: "adminpass",
  publicId: "RntlADMNAAA1",
} as const;

export const EPISODE_RENTALS_SERIES = {
  publicId: "RntlSERSAAA1",
  title: "Rental Series 001",
} as const;

/** 300 yen to keep, or 100 yen for 48 hours. */
export const EPISODE_RENTALS_EPISODE = {
  publicId: "RntlEPSDAAA1",
  title: "Rental Episode 001-01",
} as const;

/**
 * The later episodes, 200 yen each to keep and never rented. The last one
 * sells for 150 under {@link EPISODE_RENTALS_CAMPAIGN}.
 */
export const EPISODE_RENTALS_LATER_EPISODES = [
  { publicId: "RntlEPSDAAA2", title: "Rental Episode 001-02" },
  { publicId: "RntlEPSDAAA3", title: "Rental Episode 001-03" },
  { publicId: "RntlEPSDAAA4", title: "Rental Episode 001-04" },
] as const;

/**
 * The campaign open on episode 4, which ends at a fixed instant: 3:00 PM on
 * Sunday 30 March 2036 in the tenant's UTC.
 */
export const EPISODE_RENTALS_CAMPAIGN = {
  endsAt: "2036-03-30T15:00:00Z",
  episode: EPISODE_RENTALS_LATER_EPISODES[2],
} as const;

/** Episodes 2 and 3 together for 350 yen. */
export const EPISODE_RENTALS_VOLUME = {
  publicId: "RntlVOLMAAA1",
  title: "Rental Volume 1",
} as const;

/** The readers, who hold nothing yet. Password hash is `memberpass`. */
export const EPISODE_RENTALS_READERS = {
  /** Buys the permanent copy. */
  buyer: {
    email: "rental-buyer@example.com",
    password: "memberpass",
    publicId: "RntlMMBRAAA2",
  },
  /** Buys episode 4 at its campaign price. */
  campaignBuyer: {
    email: "campaign-buyer@example.com",
    password: "memberpass",
    publicId: "RntlMMBRAAA5",
  },
  /** Buys every episode in one checkout, at the series' discount. */
  remainderBuyer: {
    email: "remainder-buyer@example.com",
    password: "memberpass",
    publicId: "RntlMMBRAAA4",
  },
  /** Rents the episode for its 48 hours. */
  renter: {
    email: "rental-renter@example.com",
    password: "memberpass",
    publicId: "RntlMMBRAAA1",
  },
  /** Buys the volume from the series page. */
  volumeBuyer: {
    email: "volume-buyer@example.com",
    password: "memberpass",
    publicId: "RntlMMBRAAA3",
  },
} as const;

export const episodeRentalsSeriesPath = `/series/${EPISODE_RENTALS_SERIES.publicId}`;

export const episodeRentalPath = `${episodeRentalsSeriesPath}/episodes/${EPISODE_RENTALS_EPISODE.publicId}`;
