-- Scenario: the Author pages of the reader 320_creator_reader.sql links
--
-- `storefront.creator-pages.spec.ts` signs in as that reader and reads their
-- Author pages: the tabs of the Authors they are linked to, each one's figures,
-- and the closed months with the lines that name them. This file turns the
-- pages on for the development seed tenant, with sales shown, links the
-- reader to `Seed Author 002` beside `Seed Author 001`, and writes November and
-- December 2025 as statements closed on fixed days, so the suite neither
-- closes a month through the console nor depends on when it runs.
--
-- December credits Seed Authors 001, 002, and 003 and takes back a refund of a
-- November sale of Seed Author 001's episode, so the pages can be held to
-- showing the reader the lines of their own Author and nobody else's. A
-- closed statement refuses every change and every delete but the one a
-- deleted tenant makes to it, so the statements are written only where they
-- are missing, and the file can be applied any number of times.
--
-- The spec turns the tenant's sales off and on again by itself, so the file
-- writes both settings back to on every time it is applied. public_id values
-- are hard-coded in e2e/src/scenarios/creator-pages.ts.

\ir 320_creator_reader.sql

BEGIN;

INSERT INTO tenant_config (tenant_id, creator_pages_enabled, creator_pages_show_sales)
SELECT t.id, TRUE, TRUE
FROM tenants t
WHERE t.public_id = 'SeedTNNTAAA1'
ON CONFLICT (tenant_id) DO UPDATE
SET creator_pages_enabled = EXCLUDED.creator_pages_enabled,
    creator_pages_show_sales = EXCLUDED.creator_pages_show_sales,
    updated_at = NOW();

INSERT INTO creator_accounts (tenant_id, creator_id, user_id)
SELECT c.tenant_id, c.id, u.id
FROM creators c
JOIN users u ON u.tenant_id = c.tenant_id AND u.public_id = 'CrdrMMBRAAA1'
WHERE c.public_id = 'SeedAUTHAAA2'
ON CONFLICT (creator_id, user_id) DO NOTHING;

INSERT INTO royalty_statements (
    id,
    tenant_id,
    period,
    time_zone,
    starts_at,
    ends_at,
    closed_at,
    closed_by_user_id,
    currency,
    total_gross,
    total_refunded,
    total_adjustment,
    total_payout
)
SELECT
    s.id,
    t.id,
    s.period,
    'UTC',
    s.period::timestamp AT TIME ZONE 'UTC',
    (s.period + INTERVAL '1 month')::timestamp AT TIME ZONE 'UTC',
    s.closed_at,
    NULL,
    'JPY',
    s.total_gross,
    0,
    s.total_adjustment,
    s.total_payout
FROM (
    VALUES
        ('018f1740-0001-7000-8000-000000000001'::uuid, DATE '2025-11-01', TIMESTAMPTZ '2025-12-05 10:00:00+00', 2000, 0, 1000),
        ('018f1740-0001-7000-8000-000000000002'::uuid, DATE '2025-12-01', TIMESTAMPTZ '2026-01-05 10:00:00+00', 5500, -500, 2100)
) AS s (id, period, closed_at, total_gross, total_adjustment, total_payout)
CROSS JOIN tenants t
WHERE t.public_id = 'SeedTNNTAAA1'
ON CONFLICT (id) DO NOTHING;

-- November: four sales of Seed Episode 001-10, half of them Seed Author 001's.
-- December: six more of it, two of Seed Author 002's first episode, three of
-- Seed Author 003's, and one November sale refunded in full, which takes back
-- what that sale paid Seed Author 001.
INSERT INTO royalty_statement_lines (
    tenant_id,
    statement_id,
    line_number,
    creator_id,
    creator_name,
    series_id,
    series_title,
    episode_id,
    episode_title,
    role_id,
    role_name,
    sale_count,
    gross_amount,
    refunded_amount,
    share_bps,
    payout_amount,
    adjusted_statement_id,
    adjusted_line_number,
    source
)
SELECT
    e.tenant_id,
    line.statement_id,
    line.line_number,
    c.id,
    c.name,
    s.id,
    st.title,
    e.id,
    et.title,
    r.id,
    r.name,
    line.sale_count,
    line.gross_amount,
    0,
    line.share_bps,
    line.payout_amount,
    line.adjusted_statement_id,
    line.adjusted_line_number,
    'sale'
FROM (
    VALUES
        ('018f1740-0001-7000-8000-000000000001'::uuid, 1, 'SeedAUTHAAA1', 'SeedEPSDAA1A', 4, 2000, 5000, 1000, NULL::uuid, NULL::integer),
        ('018f1740-0001-7000-8000-000000000002'::uuid, 1, 'SeedAUTHAAA1', 'SeedEPSDAA1A', 6, 3000, 5000, 1500, NULL, NULL),
        ('018f1740-0001-7000-8000-000000000002'::uuid, 2, 'SeedAUTHAAA2', 'SeedEPSDAA11', 2, 1000, 4000, 400, NULL, NULL),
        ('018f1740-0001-7000-8000-000000000002'::uuid, 3, 'SeedAUTHAAA3', 'SeedEPSDAA21', 3, 1500, 3000, 450, NULL, NULL),
        ('018f1740-0001-7000-8000-000000000002'::uuid, 4, 'SeedAUTHAAA1', 'SeedEPSDAA1A', -1, -500, 5000, -250, '018f1740-0001-7000-8000-000000000001'::uuid, 1)
) AS line (
    statement_id,
    line_number,
    creator_public_id,
    episode_public_id,
    sale_count,
    gross_amount,
    share_bps,
    payout_amount,
    adjusted_statement_id,
    adjusted_line_number
)
JOIN episodes e ON e.public_id = line.episode_public_id
CROSS JOIN LATERAL episode_translation_for(e.id, '') et
JOIN series s ON s.id = e.series_id
CROSS JOIN LATERAL series_translation_for(s.id, '') st
JOIN creators c ON c.public_id = line.creator_public_id
JOIN creator_roles r ON r.tenant_id = e.tenant_id AND r.name = 'Original Author'
ON CONFLICT (statement_id, line_number) DO NOTHING;

COMMIT;
