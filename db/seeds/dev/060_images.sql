-- Artwork for the seeded catalogue: an eye-catch for every series and label, an
-- icon for every creator, and a body for every episode.
--
-- The rows only describe the images. The objects they name are uploaded by
-- `task storage:seed`, which reads these object keys back out of the database,
-- so the two halves cannot drift apart.
--
-- Five card designs and five icon designs are dealt round-robin, so a shelf of
-- three or six tells one series from the next. Twenty series share a design and
-- point at the same object rather than at a copy of their own, which is what
-- keeps a catalogue of a hundred series down to sixty uploaded cards; the sweep
-- that reclaims unreferenced objects keeps one as long as any row names it.
--
-- Every id here is derived from the entity's own position in the catalogue
-- rather than read back out of the image tables, so a database where somebody
-- has uploaded an eye-catch through the console seeds the same rows as a fresh
-- one.
--
-- `file_size_bytes` is what a reader is told a variant weighs, and the seeded
-- value is nominal: one figure per delivered size rather than the exact byte
-- count of each of the five cards at it. What the browser downloads is
-- image-server's WebP / AVIF rendition rather than the stored JPEG, so the
-- figure only has to be in the right range.

-- The aspect ratios and delivery widths `imageproc.eyeCatchAspectSpecs`
-- generates, with the heights they scale to. `label` states the width the way
-- an upload does, and the object keys are named after both. A temp table rather
-- than a CTE because labels and series both deal from it, and two copies of the
-- list would drift.
CREATE TEMP TABLE seed_eye_catch_variant ON COMMIT DROP AS
SELECT *
FROM (
    VALUES
        (1, 'portrait', 600, 800, 45000),
        (2, 'portrait', 900, 1200, 74000),
        (3, 'portrait', 1200, 1600, 103000),
        (4, 'square', 600, 600, 37000),
        (5, 'square', 900, 900, 61000),
        (6, 'square', 1200, 1200, 85000),
        (7, 'landscape', 800, 450, 37000),
        (8, 'landscape', 1200, 675, 60000),
        (9, 'landscape', 1600, 900, 84000),
        (10, 'og', 600, 315, 25000),
        (11, 'og', 900, 473, 41000),
        (12, 'og', 1200, 630, 58000)
) AS v (variant_no, variant_type, width, height, file_size_bytes);

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'localhost'
),
seed_label AS (
    SELECT
        l.id,
        l.tenant_id,
        ROW_NUMBER() OVER (ORDER BY l.name) AS label_no
    FROM labels l
    JOIN tenant_scope ts ON ts.id = l.tenant_id
    WHERE l.name LIKE 'Seed Label %'
),
label_image AS (
    INSERT INTO label_images (id, tenant_id, label_id)
    SELECT
        (
            '018f0e78-'
            || LPAD(TO_HEX(sl.label_no::int), 4, '0')
            || '-7000-8000-'
            || LPAD(TO_HEX(sl.label_no::int), 12, '0')
        )::uuid,
        sl.tenant_id,
        sl.id
    FROM seed_label sl
    ON CONFLICT (id) DO UPDATE
    SET tenant_id = EXCLUDED.tenant_id,
        label_id = EXCLUDED.label_id
    RETURNING id, label_id
)
UPDATE labels l
SET eye_catch_image_id = li.id
FROM label_image li
WHERE li.label_id = l.id
  AND l.eye_catch_image_id IS DISTINCT FROM li.id;

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'localhost'
),
seed_series AS (
    SELECT
        s.id,
        s.tenant_id,
        ROW_NUMBER() OVER (ORDER BY s.title) AS series_no
    FROM series s
    JOIN tenant_scope ts ON ts.id = s.tenant_id
    WHERE s.title LIKE 'Seed Series %'
),
series_image AS (
    INSERT INTO series_images (id, tenant_id, series_id)
    SELECT
        (
            '018f0e76-'
            || LPAD(TO_HEX(ss.series_no::int), 4, '0')
            || '-7000-8000-'
            || LPAD(TO_HEX(ss.series_no::int), 12, '0')
        )::uuid,
        ss.tenant_id,
        ss.id
    FROM seed_series ss
    ON CONFLICT (id) DO UPDATE
    SET tenant_id = EXCLUDED.tenant_id,
        series_id = EXCLUDED.series_id
    RETURNING id, series_id
)
-- `IS DISTINCT FROM` keeps a second run from bumping `updated_at` on a series
-- that already points at its card.
UPDATE series s
SET eye_catch_image_id = si.id,
    updated_at = NOW()
FROM series_image si
WHERE si.series_id = s.id
  AND s.eye_catch_image_id IS DISTINCT FROM si.id;

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'localhost'
),
seed_creator AS (
    SELECT
        c.id,
        c.tenant_id,
        ROW_NUMBER() OVER (ORDER BY c.name) AS creator_no
    FROM creators c
    JOIN tenant_scope ts ON ts.id = c.tenant_id
    WHERE c.name LIKE 'Seed Author %'
),
creator_image AS (
    INSERT INTO creator_images (id, tenant_id, creator_id)
    SELECT
        (
            '018f0e7a-'
            || LPAD(TO_HEX(sc.creator_no::int), 4, '0')
            || '-7000-8000-'
            || LPAD(TO_HEX(sc.creator_no::int), 12, '0')
        )::uuid,
        sc.tenant_id,
        sc.id
    FROM seed_creator sc
    ON CONFLICT (id) DO UPDATE
    SET tenant_id = EXCLUDED.tenant_id,
        creator_id = EXCLUDED.creator_id
    RETURNING id, creator_id
)
UPDATE creators c
SET icon_image_id = ci.id
FROM creator_image ci
WHERE ci.creator_id = c.id
  AND c.icon_image_id IS DISTINCT FROM ci.id;

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'localhost'
),
seed_label AS (
    SELECT
        l.tenant_id,
        ROW_NUMBER() OVER (ORDER BY l.name) AS label_no
    FROM labels l
    JOIN tenant_scope ts ON ts.id = l.tenant_id
    WHERE l.name LIKE 'Seed Label %'
),
label_variant AS (
    SELECT
        sl.tenant_id,
        sl.label_no,
        ((sl.label_no - 1) * 12 + v.variant_no) AS seq_no,
        ((sl.label_no - 1) % 5) + 1 AS card_no,
        v.variant_type,
        v.width,
        v.height,
        v.file_size_bytes
    FROM seed_label sl
    CROSS JOIN seed_eye_catch_variant v
)
INSERT INTO label_image_variants (
    id,
    tenant_id,
    label_image_id,
    label,
    variant_type,
    storage_provider,
    object_key,
    content_type,
    file_size_bytes,
    width,
    height
)
SELECT
    (
        '018f0e79-'
        || LPAD(TO_HEX(lv.seq_no::int), 4, '0')
        || '-7000-8000-'
        || LPAD(TO_HEX(lv.seq_no::int), 12, '0')
    )::uuid,
    lv.tenant_id,
    (
        '018f0e78-'
        || LPAD(TO_HEX(lv.label_no::int), 4, '0')
        || '-7000-8000-'
        || LPAD(TO_HEX(lv.label_no::int), 12, '0')
    )::uuid,
    'w' || lv.width,
    lv.variant_type,
    's3',
    FORMAT(
        'tenants/SeedTNNTAAA1/seed/eye-catch/card-%s-%s-w%s.jpg',
        lv.card_no,
        lv.variant_type,
        lv.width
    ),
    'image/jpeg',
    lv.file_size_bytes,
    lv.width,
    lv.height
FROM label_variant lv
ON CONFLICT (id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    label_image_id = EXCLUDED.label_image_id,
    label = EXCLUDED.label,
    variant_type = EXCLUDED.variant_type,
    storage_provider = EXCLUDED.storage_provider,
    object_key = EXCLUDED.object_key,
    content_type = EXCLUDED.content_type,
    file_size_bytes = EXCLUDED.file_size_bytes,
    width = EXCLUDED.width,
    height = EXCLUDED.height;

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'localhost'
),
seed_series AS (
    SELECT
        s.tenant_id,
        ROW_NUMBER() OVER (ORDER BY s.title) AS series_no
    FROM series s
    JOIN tenant_scope ts ON ts.id = s.tenant_id
    WHERE s.title LIKE 'Seed Series %'
),
series_variant AS (
    SELECT
        ss.tenant_id,
        ss.series_no,
        ((ss.series_no - 1) * 12 + v.variant_no) AS seq_no,
        ((ss.series_no - 1) % 5) + 1 AS card_no,
        v.variant_type,
        v.width,
        v.height,
        v.file_size_bytes
    FROM seed_series ss
    CROSS JOIN seed_eye_catch_variant v
)
INSERT INTO series_image_variants (
    id,
    tenant_id,
    series_image_id,
    label,
    variant_type,
    storage_provider,
    object_key,
    content_type,
    file_size_bytes,
    width,
    height
)
SELECT
    (
        '018f0e77-'
        || LPAD(TO_HEX(sv.seq_no::int), 4, '0')
        || '-7000-8000-'
        || LPAD(TO_HEX(sv.seq_no::int), 12, '0')
    )::uuid,
    sv.tenant_id,
    (
        '018f0e76-'
        || LPAD(TO_HEX(sv.series_no::int), 4, '0')
        || '-7000-8000-'
        || LPAD(TO_HEX(sv.series_no::int), 12, '0')
    )::uuid,
    'w' || sv.width,
    sv.variant_type,
    's3',
    FORMAT(
        'tenants/SeedTNNTAAA1/seed/eye-catch/card-%s-%s-w%s.jpg',
        sv.card_no,
        sv.variant_type,
        sv.width
    ),
    'image/jpeg',
    sv.file_size_bytes,
    sv.width,
    sv.height
FROM series_variant sv
ON CONFLICT (id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    series_image_id = EXCLUDED.series_image_id,
    label = EXCLUDED.label,
    variant_type = EXCLUDED.variant_type,
    storage_provider = EXCLUDED.storage_provider,
    object_key = EXCLUDED.object_key,
    content_type = EXCLUDED.content_type,
    file_size_bytes = EXCLUDED.file_size_bytes,
    width = EXCLUDED.width,
    height = EXCLUDED.height;

-- One square, the way `createCreatorIconImage` stores an icon: a single
-- `original` variant at the size the console cropped it to.
WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'localhost'
),
seed_creator AS (
    SELECT
        c.tenant_id,
        ROW_NUMBER() OVER (ORDER BY c.name) AS creator_no
    FROM creators c
    JOIN tenant_scope ts ON ts.id = c.tenant_id
    WHERE c.name LIKE 'Seed Author %'
)
INSERT INTO creator_image_variants (
    id,
    tenant_id,
    creator_image_id,
    label,
    storage_provider,
    object_key,
    content_type,
    file_size_bytes,
    width,
    height
)
SELECT
    (
        '018f0e7b-'
        || LPAD(TO_HEX(sc.creator_no::int), 4, '0')
        || '-7000-8000-'
        || LPAD(TO_HEX(sc.creator_no::int), 12, '0')
    )::uuid,
    sc.tenant_id,
    (
        '018f0e7a-'
        || LPAD(TO_HEX(sc.creator_no::int), 4, '0')
        || '-7000-8000-'
        || LPAD(TO_HEX(sc.creator_no::int), 12, '0')
    )::uuid,
    'original',
    's3',
    FORMAT(
        'tenants/SeedTNNTAAA1/seed/creator-icon/icon-%s.jpg',
        ((sc.creator_no - 1) % 5) + 1
    ),
    'image/jpeg',
    11000,
    512,
    512
FROM seed_creator sc
ON CONFLICT (id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    creator_image_id = EXCLUDED.creator_image_id,
    label = EXCLUDED.label,
    storage_provider = EXCLUDED.storage_provider,
    object_key = EXCLUDED.object_key,
    content_type = EXCLUDED.content_type,
    file_size_bytes = EXCLUDED.file_size_bytes,
    width = EXCLUDED.width,
    height = EXCLUDED.height;

-- Every episode gets the same eight pages. An episode with no body is not a
-- state a storefront ever puts in front of a reader, so a seeded catalogue must
-- not hold one: whichever episode a contributor opens, the viewer, its page
-- chrome, and the offline library all have something to work on.
WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'localhost'
),
seed_episode AS (
    SELECT
        e.id,
        e.tenant_id,
        ROW_NUMBER() OVER (ORDER BY s.title, e.order_index) AS episode_no
    FROM episodes e
    JOIN series s ON s.id = e.series_id
    JOIN tenant_scope ts ON ts.id = s.tenant_id
    WHERE s.title LIKE 'Seed Series %'
)
INSERT INTO episode_images (id, tenant_id, episode_id, display_order)
SELECT
    (
        '018f0e7c-'
        || LPAD(TO_HEX(((se.episode_no - 1) * 8 + page.page_no)::int), 4, '0')
        || '-7000-8000-'
        || LPAD(TO_HEX(((se.episode_no - 1) * 8 + page.page_no)::int), 12, '0')
    )::uuid,
    se.tenant_id,
    se.id,
    page.page_no
FROM seed_episode se
CROSS JOIN GENERATE_SERIES(1, 8) AS page(page_no)
ON CONFLICT (id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    episode_id = EXCLUDED.episode_id,
    display_order = EXCLUDED.display_order;

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'localhost'
),
seed_episode AS (
    SELECT
        e.tenant_id,
        ROW_NUMBER() OVER (ORDER BY s.title, e.order_index) AS episode_no
    FROM episodes e
    JOIN series s ON s.id = e.series_id
    JOIN tenant_scope ts ON ts.id = s.tenant_id
    WHERE s.title LIKE 'Seed Series %'
),
seed_page AS (
    SELECT
        se.tenant_id,
        ((se.episode_no - 1) * 8 + page.page_no) AS seq_no,
        page.page_no
    FROM seed_episode se
    CROSS JOIN GENERATE_SERIES(1, 8) AS page(page_no)
)
INSERT INTO episode_image_variants (
    id,
    tenant_id,
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
    (
        '018f0e7d-'
        || LPAD(TO_HEX(sp.seq_no::int), 4, '0')
        || '-7000-8000-'
        || LPAD(TO_HEX(sp.seq_no::int), 12, '0')
    )::uuid,
    sp.tenant_id,
    (
        '018f0e7c-'
        || LPAD(TO_HEX(sp.seq_no::int), 4, '0')
        || '-7000-8000-'
        || LPAD(TO_HEX(sp.seq_no::int), 12, '0')
    )::uuid,
    'original',
    's3',
    FORMAT(
        'tenants/SeedTNNTAAA1/seed/episode-page/page-%s.jpg',
        LPAD(sp.page_no::text, 2, '0')
    ),
    'image/jpeg',
    120000,
    1050,
    1500
FROM seed_page sp
ON CONFLICT (id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    episode_image_id = EXCLUDED.episode_image_id,
    label = EXCLUDED.label,
    storage_provider = EXCLUDED.storage_provider,
    object_key = EXCLUDED.object_key,
    content_type = EXCLUDED.content_type,
    file_size_bytes = EXCLUDED.file_size_bytes,
    width = EXCLUDED.width,
    height = EXCLUDED.height;
