-- Scenario: the closed royalty statement the documentation's screenshots show
--
-- The page under docs/<locale>/4-console/ about reports and royalties explains
-- the Closed statements list and a statement, and the royalty tenant,
-- RoyaTNNTAAA1, which 260_royalties.sql creates and this file needs first,
-- has no month closed. Closing one through the console stamps it with the
-- moment it was closed, which a screenshot compared pixel by pixel cannot
-- absorb, so December 2025 is written as a statement closed on a fixed day by
-- the tenant's admin: the episode of that file sold eight times, credited 30%
-- and 20% to its two Authors, as January's sales are.
--
-- Applied by e2e/tests/admin.docs-screenshots.setup.ts. The royalties suite
-- applies 260_royalties.sql again before it runs, which deletes the tenant
-- with this statement, and closes January itself.

BEGIN;

DELETE FROM royalty_statements
WHERE id = '018f1090-0006-7000-8000-000000000001'::uuid;

INSERT INTO royalty_statements (
    id,
    tenant_id,
    period,
    time_zone,
    closed_at,
    closed_by_user_id,
    total_gross,
    total_refunded,
    total_payout
)
SELECT
    '018f1090-0006-7000-8000-000000000001'::uuid,
    t.id,
    DATE '2025-12-01',
    'UTC',
    TIMESTAMPTZ '2026-01-05 10:00:00+00',
    u.id,
    4000,
    0,
    2000
FROM tenants t
JOIN users u ON u.public_id = 'RoyaADMNAAA1'
WHERE t.public_id = 'RoyaTNNTAAA1';

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
    payout_amount
)
SELECT
    e.tenant_id,
    '018f1090-0006-7000-8000-000000000001'::uuid,
    line.line_number,
    c.id,
    c.name,
    s.id,
    s.title,
    e.id,
    e.title,
    r.id,
    r.name,
    8,
    4000,
    0,
    line.share_bps,
    4000 * line.share_bps / 10000
FROM (
    VALUES
        (1, 'RoyaAUTHAAA1', 'Artist', 3000),
        (2, 'RoyaAUTHAAA2', 'Original Author', 2000)
) AS line (line_number, creator_public_id, role_name, share_bps)
JOIN episodes e ON e.public_id = 'RoyaEPSDAAA1'
JOIN series s ON s.id = e.series_id
JOIN creators c ON c.public_id = line.creator_public_id
JOIN creator_roles r ON r.tenant_id = e.tenant_id AND r.name = line.role_name;

COMMIT;
