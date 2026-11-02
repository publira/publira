-- Scenario: a priced episode of the seed tenant that opens three pages as a
-- preview
--
-- `storefront.episode-preview.spec.ts` turns through the preview to the gate
-- after it. The episode is `Seed Episode 020-01`, which no other suite opens:
-- `Seed Episode 001-10`, the seed's one priced episode, stays without a
-- preview for the suites that meet its gate on the first page. Every seeded
-- episode has eight pages (`db/seeds/dev/060_images.sql`), so three of them
-- open and five stay behind the gate.
--
-- Only the listing changes, so applying this again is a no-op.
--   tenant   SeedTNNTAAA1
--   series   SeedSERSAA2A (Seed Series 020)
--   episode  SeedEPSDA191 (Seed Episode 020-01), 300 yen, 3 preview pages

UPDATE episode_listings el
SET price = 300,
    preview_page_count = 3
FROM episodes e
JOIN tenants t ON t.id = e.tenant_id
WHERE el.episode_id = e.id
    AND t.public_id = 'SeedTNNTAAA1'
    AND e.public_id = 'SeedEPSDA191';
