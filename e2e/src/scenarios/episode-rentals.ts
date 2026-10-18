/**
 * Records created by `db/seeds/scenarios/550_episode_rentals.sql`. Re-applying
 * it deletes the tenant and writes it again, which takes the payment settings
 * the suite stores with it and gives the rental its 47 hours back.
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

/** The readers. Password hash is `memberpass`. */
export const EPISODE_RENTALS_READERS = {
  /** Holds neither sale, so the gate offers both. */
  chooser: {
    email: "rental-chooser@example.com",
    password: "memberpass",
    publicId: "RntlMMBRAAA1",
  },
  /** Rented the episode an hour ago, with 47 hours left. */
  holder: {
    email: "rental-holder@example.com",
    password: "memberpass",
    publicId: "RntlMMBRAAA2",
  },
} as const;

export const episodeRentalPath = `/series/${EPISODE_RENTALS_SERIES.publicId}/episodes/${EPISODE_RENTALS_EPISODE.publicId}`;
