-- Sample access ticket: member can view paid Seed Episode 001-10 without purchase.

WITH scope AS (
    SELECT
        t.id AS tenant_id,
        u.id AS user_id,
        e.id AS episode_id
    FROM tenants t
    JOIN users u ON u.tenant_id = t.id AND u.email = 'member@example.com'
    JOIN series s ON s.tenant_id = t.id AND s.title = 'Seed Series 001'
    JOIN episodes e ON e.series_id = s.id AND e.title = 'Seed Episode 001-10'
    WHERE t.domain = 'localhost'
)
INSERT INTO access_tickets (
    id,
    tenant_id,
    public_id,
    episode_id,
    user_id,
    expires_at,
    note,
    created_by_user_id
)
SELECT
    '018f0e80-0001-7000-8000-000000000001'::uuid,
    scope.tenant_id,
    'SeedTCKTAAA1',
    scope.episode_id,
    scope.user_id,
    NULL,
    'Seed: complimentary access for Sample Member',
    (
        SELECT u.id
        FROM users u
        WHERE u.tenant_id = scope.tenant_id
            AND u.email = 'admin@example.com'
        LIMIT 1
    )
FROM scope
ON CONFLICT (tenant_id, public_id) DO UPDATE
SET episode_id = EXCLUDED.episode_id,
    user_id = EXCLUDED.user_id,
    expires_at = EXCLUDED.expires_at,
    note = EXCLUDED.note,
    revoked_at = NULL;
