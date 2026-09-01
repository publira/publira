-- Scenario: episode body images for the canvas viewer.
--
-- The dev seed publishes episodes but no pages, so the reader opens on "no
-- body images" and nothing about drawing a page can be observed. This gives
-- `Seed Episode 001-02` (SeedEPSDAAA2, free and already published) eight pages
-- so the viewer has something to fetch, decode, and draw.
--
-- Not the first episode of the series: `Seed Episode 001-01` is the one other
-- suites reach for, and mobile's live integration test reads its empty state as
-- proof of a working round trip. An episode nothing else asserts on keeps this
-- fixture from changing what those tests mean.
--
-- The rows only describe the pages. The objects themselves are uploaded by
-- `e2e/scripts/seed-viewer-pages.sh`, which reads these object keys back out
-- of the database, so the two cannot drift apart.
--
-- Fixed UUIDs (`0199a121-1121-70xx-…`) keep the scenario idempotent: applying
-- it twice updates the same eight images instead of appending eight more.
--
-- Used by e2e/tests/host.viewer-performance.spec.ts.

BEGIN;

CREATE TEMP TABLE viewer_page ON COMMIT DROP AS
SELECT
    page_number,
    ('0199a121-1121-7000-8000-' || lpad(page_number::text, 12, '0'))::uuid AS image_id,
    ('0199a121-1121-7001-8000-' || lpad(page_number::text, 12, '0'))::uuid AS variant_id,
    'tenants/SeedTNNTAAA1/episodes/SeedEPSDAAA2/page-'
        || lpad(page_number::text, 2, '0')
        || '-original.jpg' AS object_key
FROM generate_series(1, 8) AS page_number;

INSERT INTO episode_images (id, tenant_id, episode_id, display_order)
SELECT
    viewer_page.image_id,
    series.tenant_id,
    episode.id,
    viewer_page.page_number
FROM viewer_page
    CROSS JOIN episodes episode
    JOIN series ON series.id = episode.series_id
WHERE episode.public_id = 'SeedEPSDAAA2'
ON CONFLICT (id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    episode_id = EXCLUDED.episode_id,
    display_order = EXCLUDED.display_order;

INSERT INTO episode_image_variants (
    id,
    episode_image_id,
    label,
    storage_provider,
    object_key,
    content_type,
    file_size_bytes,
    width,
    height
)
SELECT
    viewer_page.variant_id,
    viewer_page.image_id,
    'original',
    's3',
    viewer_page.object_key,
    'image/jpeg',
    -- Reported to the reader as the page's byte size. What the browser
    -- downloads is image-server's WebP / AVIF rendition rather than this
    -- JPEG, so the fixture's own size only has to be in the right range.
    120000,
    -- e2e/fixtures/viewer-pages/page-NN.jpg
    1050,
    1500
FROM viewer_page
ON CONFLICT (id) DO UPDATE
SET episode_image_id = EXCLUDED.episode_image_id,
    label = EXCLUDED.label,
    storage_provider = EXCLUDED.storage_provider,
    object_key = EXCLUDED.object_key,
    content_type = EXCLUDED.content_type,
    file_size_bytes = EXCLUDED.file_size_bytes,
    width = EXCLUDED.width,
    height = EXCLUDED.height;

COMMIT;
