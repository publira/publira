-- Scenario: the campaign banners the documentation's screenshots show
--
-- The page under docs/<locale>/4-console/3-setup/ about campaign banners
-- explains the list and the standing each row reads as, and the development
-- seed holds three banners that all read Showing, over a window it dates from
-- the moment it runs. This file gives those three literal windows and adds
-- three banners to the seed tenant beside them: one scheduled, one ended, and
-- one unpublished. Every date is a literal, for the reason
-- 160_screenshot_baseline.sql gives; the open windows end, and the scheduled
-- one starts, years ahead, so each row keeps its standing on every run.
--
-- The seed tenant's site shows only the banners on air, and the added ones
-- never are, so its top page still opens on the seed's three banners in their
-- order, which is what storefront.campaign-banners.spec.ts reads. Each added
-- banner shows one of the seed's landscape images, reusing its stored objects,
-- so nothing has to be uploaded for them.
--
-- Applied by e2e/tests/admin.docs-screenshots.setup.ts. The file deletes its
-- own banners, and their images with them, before writing them, so it can be
-- applied any number of times.
--
-- ID band: 018f1090-0008-7000-8000-0000000000NN for the banners, -8001- for
-- their images, and -8002- for the images' variants.

BEGIN;

UPDATE campaign_banners cb
SET starts_at = w.starts_at,
    ends_at = w.ends_at,
    start_revalidated_at = w.starts_at,
    end_revalidated_at = NULL
FROM (
    VALUES
        (
            '018f0e93-0000-7000-8000-000000000001'::uuid,
            '2026-03-01T00:00:00Z'::timestamptz,
            '2036-03-01T00:00:00Z'::timestamptz
        ),
        (
            '018f0e93-0000-7000-8000-000000000002'::uuid,
            '2026-03-15T00:00:00Z'::timestamptz,
            '2036-03-15T00:00:00Z'::timestamptz
        ),
        (
            '018f0e93-0000-7000-8000-000000000003'::uuid,
            '2026-04-01T00:00:00Z'::timestamptz,
            '2036-04-01T00:00:00Z'::timestamptz
        )
) AS w (id, starts_at, ends_at)
WHERE cb.id = w.id;

DELETE FROM campaign_banners
WHERE id IN (
    '018f1090-0008-7000-8000-000000000001'::uuid,
    '018f1090-0008-7000-8000-000000000002'::uuid,
    '018f1090-0008-7000-8000-000000000003'::uuid
);

CREATE TEMP TABLE docs_campaign_banner ON COMMIT DROP AS
SELECT *
FROM (
    VALUES
        -- Scheduled: published, and due years ahead.
        (
            1,
            'DocsBNNRAAA1',
            '/series/SeedSERSAAA2',
            '2030-07-01T00:00:00Z'::timestamptz,
            '2030-08-01T00:00:00Z'::timestamptz,
            TRUE,
            NULL::timestamptz,
            NULL::timestamptz,
            1
        ),
        -- Ended: published, and over before the seed's banners began.
        (
            2,
            'DocsBNNRAAA2',
            'https://example.com/spring-fair',
            '2026-01-05T00:00:00Z'::timestamptz,
            '2026-01-19T00:00:00Z'::timestamptz,
            TRUE,
            '2026-01-05T00:00:00Z'::timestamptz,
            '2026-01-19T00:00:00Z'::timestamptz,
            2
        ),
        -- Unpublished: its window is open, and it still never shows.
        (
            3,
            'DocsBNNRAAA3',
            '/series/SeedSERSAAA3',
            '2026-03-01T00:00:00Z'::timestamptz,
            '2036-03-01T00:00:00Z'::timestamptz,
            FALSE,
            NULL::timestamptz,
            NULL::timestamptz,
            3
        )
) AS b (
    banner_no,
    public_id,
    link_url,
    starts_at,
    ends_at,
    is_published,
    start_revalidated_at,
    end_revalidated_at,
    seed_banner_no
);

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
    end_revalidated_at,
    created_at,
    updated_at
)
SELECT
    ('018f1090-0008-7000-8000-' || LPAD(b.banner_no::text, 12, '0'))::uuid,
    ts.id,
    b.public_id,
    b.link_url,
    b.starts_at,
    b.ends_at,
    -- After the seed's three, in the order the rows above are listed.
    3 + b.banner_no,
    b.is_published,
    b.start_revalidated_at,
    b.end_revalidated_at,
    '2026-01-02T00:00:00Z'::timestamptz,
    '2026-01-02T00:00:00Z'::timestamptz
FROM docs_campaign_banner b
CROSS JOIN tenant_scope ts;

INSERT INTO campaign_banner_images (id, tenant_id, campaign_banner_id, created_at, updated_at)
SELECT
    ('018f1090-0008-7000-8001-' || LPAD(b.banner_no::text, 12, '0'))::uuid,
    cb.tenant_id,
    cb.id,
    '2026-01-02T00:00:00Z'::timestamptz,
    '2026-01-02T00:00:00Z'::timestamptz
FROM docs_campaign_banner b
JOIN campaign_banners cb
    ON cb.id = ('018f1090-0008-7000-8000-' || LPAD(b.banner_no::text, 12, '0'))::uuid;

UPDATE campaign_banners cb
SET image_id = ('018f1090-0008-7000-8001-' || LPAD(b.banner_no::text, 12, '0'))::uuid
FROM docs_campaign_banner b
WHERE cb.id = ('018f1090-0008-7000-8000-' || LPAD(b.banner_no::text, 12, '0'))::uuid;

-- The seed banner's landscape variants, copied onto each added banner's image
-- with the same object keys.
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
        '018f1090-0008-7000-8002-'
        || LPAD(
            (
                (b.banner_no - 1) * 3
                + ROW_NUMBER() OVER (PARTITION BY b.banner_no ORDER BY v.width)
            )::text,
            12,
            '0'
        )
    )::uuid,
    v.tenant_id,
    ('018f1090-0008-7000-8001-' || LPAD(b.banner_no::text, 12, '0'))::uuid,
    v.label,
    v.variant_type,
    v.storage_provider,
    v.object_key,
    v.content_type,
    v.file_size_bytes,
    v.width,
    v.height
FROM docs_campaign_banner b
JOIN campaign_banner_image_variants v
    ON v.campaign_banner_image_id
        = ('018f0e94-0000-7000-8000-' || LPAD(TO_HEX(b.seed_banner_no), 12, '0'))::uuid;

COMMIT;
