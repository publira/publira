-- Scenario: a run of the seed tenant that goes free, paid, paid, free
--
-- `storefront.episode-reading.spec.ts` finishes `Seed Episode 012-02`, which
-- is free, and meets `Seed Episode 012-03` as the next episode at a price,
-- with `Seed Episode 012-05` as the next one it can read for free. The
-- development seed prices only `Seed Episode 001-10`, the last of its series,
-- so no seeded series has a free episode after a paid one. `Seed Series 012`
-- is one no other suite opens.
--
-- Only the listings change, so applying this again is a no-op.
--   tenant    SeedTNNTAAA1
--   series    SeedSERSAA12 (Seed Series 012)
--   episodes  SeedEPSDA113 (Seed Episode 012-03), 300 yen
--             SeedEPSDA114 (Seed Episode 012-04), 300 yen

UPDATE episode_listings el
SET price = 300
FROM episodes e
JOIN tenants t ON t.id = e.tenant_id
WHERE el.episode_id = e.id
    AND t.public_id = 'SeedTNNTAAA1'
    AND e.public_id IN ('SeedEPSDA113', 'SeedEPSDA114');
