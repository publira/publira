/**
 * Records created by `db/seeds/scenarios/010_multi_tenant.sql`.
 *
 * public_id values are the first 12 hex digits of the fixture UUIDs, so they
 * are stable; keep them in sync with the SQL header comment.
 */
export const MULTI_TENANT_SCENARIO = "010_multi_tenant";

/** Second tenant, served on Host `other.localhost`. */
export const OTHER_TENANT = {
  authorId: "018F0F020001",
  authorName: "Boundary Author 001",
  labelName: "Boundary Label 01",
  name: "Boundary Tenant",
  /** Published, with two published episodes and one still scheduled. */
  publishedSeries: {
    episodeIds: ["018F0F040001", "018F0F040002"] as const,
    episodeTitles: [
      "Boundary Episode 001-01",
      "Boundary Episode 001-02",
    ] as const,
    publicId: "018F0F030001",
    scheduledEpisodeTitle: "Boundary Episode 001-90",
    synopsis: "Boundary series synopsis for Boundary Series 001",
    title: "Boundary Series 001",
  },
  siteDescription: "Boundary Tenant の公開向け説明テキストです。",
  /** Never published: must not be listed and must not have a detail page. */
  unpublishedSeries: {
    publicId: "018F0F030002",
    title: "Boundary Draft Series 900",
  },
} as const;

/** Dev seed tenant, served on Host `localhost` (db/seeds/dev/*.sql). */
export const SEED_TENANT = {
  authorId: "018F0E710001",
  authorName: "Seed Author 001",
  name: "Seed Tenant",
  series: {
    /** `Seed Episode 001-10` is the priced one; 001-01 is free. */
    freeEpisodeId: "018F0E730001",
    freeEpisodeTitle: "Seed Episode 001-01",
    publicId: "018F0E720001",
    title: "Seed Series 001",
  },
} as const;

/** A syntactically valid public_id that no record uses. */
export const MISSING_PUBLIC_ID = "ZZZZZZZZZZZZ";
