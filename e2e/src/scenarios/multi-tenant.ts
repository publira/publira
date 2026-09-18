/**
 * Records created by `db/seeds/scenarios/010_multi_tenant.sql`.
 *
 * public_id values are fixed Base58 literals in the seed SQL, so they are
 * stable; keep them in sync with the SQL header comment.
 */
export const MULTI_TENANT_SCENARIO = "010_multi_tenant";

/** Second tenant, served on Host `other.localhost`. */
export const OTHER_TENANT = {
  creatorId: "BndrAUTHAAA1",
  creatorName: "Boundary Author 001",
  labelId: "BndrLABLAAA1",
  labelName: "Boundary Label 01",
  name: "Boundary Tenant",
  /**
   * Draft page, addressed by uuid rather than a public_id. The seed tenant's
   * console must answer `/pages/<id>` for it the same way it answers an id
   * that never existed.
   */
  page: {
    id: "018f0f05-0001-7000-8000-000000000001",
    slug: "/boundary-page",
    title: "Boundary Page 001",
  },
  /** Published, with two published episodes and one still scheduled. */
  publishedSeries: {
    episodeIds: ["BndrEPSDAAA1", "BndrEPSDAAA2"] as const,
    episodeTitles: [
      "Boundary Episode 001-01",
      "Boundary Episode 001-02",
    ] as const,
    publicId: "BndrSERSAAA1",
    scheduledEpisodeId: "BndrEPSDAAA3",
    scheduledEpisodeTitle: "Boundary Episode 001-90",
    synopsis: "Boundary series synopsis for Boundary Series 001",
    title: "Boundary Series 001",
  },
  siteDescription: "Public description text for Boundary Tenant.",
  /** Off UTC on purpose: the tenant whose day is not the server's day. */
  timeZone: "Asia/Tokyo",
  /** Never published: must not be listed and must not have a detail page. */
  unpublishedSeries: {
    publicId: "BndrSERSAAA2",
    title: "Boundary Draft Series 900",
  },
} as const;

/** Dev seed tenant, served on Host `localhost` (db/seeds/dev/*.sql). */
export const SEED_TENANT = {
  creatorId: "SeedAUTHAAA1",
  creatorName: "Seed Author 001",
  labelId: "SeedLABLAAA1",
  labelName: "Seed Label 01",
  name: "Seed Tenant",
  publicId: "SeedTNNTAAA1",
  /** R15-rated series for age confirmation tests (`db/seeds/dev/010_catalog.sql`). */
  r15Series: {
    freeEpisodeId: "SeedEPSDAA51",
    freeEpisodeTitle: "Seed Episode 006-01",
    publicId: "SeedSERSAAA6",
    title: "Seed Series 006",
  },
  /** R18-rated series for age confirmation tests (`db/seeds/dev/010_catalog.sql`). */
  r18Series: {
    freeEpisodeId: "SeedEPSDAA61",
    freeEpisodeTitle: "Seed Episode 007-01",
    publicId: "SeedSERSAAA7",
    title: "Seed Series 007",
  },
  series: {
    /** `Seed Episode 001-10` is the priced one; 001-01 is free. */
    freeEpisodeId: "SeedEPSDAAA1",
    freeEpisodeTitle: "Seed Episode 001-01",
    /**
     * seq_no 10 → `SeedEPSD` + TRANSLATE('0010','0','A') in
     * `db/seeds/dev/010_catalog.sql`. Complimentary ticket: SeedTCKTAAA1.
     */
    paidEpisodeId: "SeedEPSDAA1A",
    paidEpisodeTitle: "Seed Episode 001-10",
    publicId: "SeedSERSAAA1",
    title: "Seed Series 001",
  },
} as const;

/** A syntactically valid public_id that no record uses. */
export const MISSING_PUBLIC_ID = "ZZZZZZZZZZZZ";
