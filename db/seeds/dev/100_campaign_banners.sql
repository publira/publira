-- Three published campaign banners on the development seed tenant, so its top
-- page opens on the strip a tenant running more than one campaign shows, and
-- the console's Campaign banners screen has rows to manage.
--
-- Each links somewhere the seed has: a series, a label, and the free shelf's
-- full list. The window is dated from the moment the file is applied — opened
-- a day before and closed ten years after — so a development database keeps
-- showing them however long ago it was seeded, and applying the file again
-- re-dates them rather than adding to them. The start is in the past and is
-- recorded as applied, which is what a save through the console records for a
-- start it stores in the past.
--
-- Only the landscape ratio is stored, at the three widths an upload is cut to:
-- it is the ratio the site's band and the console's list draw, and a banner's
-- image is otherwise stored the way an eye-catch is (`060_images.sql`). The
-- objects are rendered from `assets/seeds/campaign-banner/` and uploaded by
-- `task storage:seed`, which reads these object keys back out of the database.

CREATE TEMP TABLE seed_campaign_banner ON COMMIT DROP AS
SELECT *
FROM (
    VALUES
        (1, 'SeedBNNRAAA1', '/series/SeedSERSAAA1'),
        (2, 'SeedBNNRAAA2', '/labels/SeedLABLAAA1'),
        (3, 'SeedBNNRAAA3', '/series?free=1')
) AS b (banner_no, public_id, link_url);

-- The widths `imageproc` cuts the landscape ratio to, with the heights they
-- scale to. `file_size_bytes` is nominal, as it is for the eye-catches.
CREATE TEMP TABLE seed_campaign_banner_variant ON COMMIT DROP AS
SELECT *
FROM (
    VALUES
        (1, 800, 450, 20000),
        (2, 1200, 675, 32000),
        (3, 1600, 900, 42000)
) AS v (variant_no, width, height, file_size_bytes);

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.public_id = 'SeedTNNTAAA1'
)
INSERT INTO campaign_banners (
    id,
    tenant_id,
    public_id,
    link_url,
    starts_at,
    ends_at,
    display_order,
    is_published,
    start_revalidated_at,
    end_revalidated_at
)
SELECT
    ('018f0e93-0000-7000-8000-' || LPAD(TO_HEX(b.banner_no), 12, '0'))::uuid,
    ts.id,
    b.public_id,
    b.link_url,
    NOW() - INTERVAL '1 day',
    NOW() + INTERVAL '10 years',
    b.banner_no,
    TRUE,
    NOW(),
    NULL
FROM seed_campaign_banner b
CROSS JOIN tenant_scope ts
ON CONFLICT (id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    public_id = EXCLUDED.public_id,
    link_url = EXCLUDED.link_url,
    starts_at = EXCLUDED.starts_at,
    ends_at = EXCLUDED.ends_at,
    display_order = EXCLUDED.display_order,
    is_published = EXCLUDED.is_published,
    start_revalidated_at = EXCLUDED.start_revalidated_at,
    end_revalidated_at = EXCLUDED.end_revalidated_at,
    updated_at = NOW();

INSERT INTO campaign_banner_images (id, tenant_id, campaign_banner_id)
SELECT
    ('018f0e94-0000-7000-8000-' || LPAD(TO_HEX(b.banner_no), 12, '0'))::uuid,
    cb.tenant_id,
    cb.id
FROM seed_campaign_banner b
JOIN campaign_banners cb
    ON cb.id = ('018f0e93-0000-7000-8000-' || LPAD(TO_HEX(b.banner_no), 12, '0'))::uuid
ON CONFLICT (id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    campaign_banner_id = EXCLUDED.campaign_banner_id;

UPDATE campaign_banners cb
SET image_id = ('018f0e94-0000-7000-8000-' || LPAD(TO_HEX(b.banner_no), 12, '0'))::uuid
FROM seed_campaign_banner b
WHERE cb.id = ('018f0e93-0000-7000-8000-' || LPAD(TO_HEX(b.banner_no), 12, '0'))::uuid
    AND cb.image_id IS DISTINCT FROM ('018f0e94-0000-7000-8000-' || LPAD(TO_HEX(b.banner_no), 12, '0'))::uuid;

INSERT INTO campaign_banner_image_variants (
    id,
    tenant_id,
    campaign_banner_image_id,
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
        '018f0e95-0000-7000-8000-'
        || LPAD(TO_HEX((b.banner_no - 1) * 3 + v.variant_no), 12, '0')
    )::uuid,
    cbi.tenant_id,
    cbi.id,
    'w' || v.width,
    'landscape',
    's3',
    FORMAT(
        'tenants/SeedTNNTAAA1/seed/campaign-banner/banner-%s-landscape-w%s.jpg',
        b.banner_no,
        v.width
    ),
    'image/jpeg',
    v.file_size_bytes,
    v.width,
    v.height
FROM seed_campaign_banner b
JOIN campaign_banner_images cbi
    ON cbi.id = ('018f0e94-0000-7000-8000-' || LPAD(TO_HEX(b.banner_no), 12, '0'))::uuid
CROSS JOIN seed_campaign_banner_variant v
ON CONFLICT (id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    campaign_banner_image_id = EXCLUDED.campaign_banner_image_id,
    label = EXCLUDED.label,
    variant_type = EXCLUDED.variant_type,
    storage_provider = EXCLUDED.storage_provider,
    object_key = EXCLUDED.object_key,
    content_type = EXCLUDED.content_type,
    file_size_bytes = EXCLUDED.file_size_bytes,
    width = EXCLUDED.width,
    height = EXCLUDED.height;
