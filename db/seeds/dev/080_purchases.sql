-- The member's purchases of the priced Seed Episode 001-10: one that does not
-- expire and a 72-hour rental that ran out, so the purchase library shows a
-- readable row and an expired one.

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
),
purchase_seed (id, purchased_at, expires_at) AS (
    VALUES
        (
            '018f0e8f-1000-7000-8000-000000000001'::uuid,
            '2026-02-01T12:00:00Z'::timestamptz,
            NULL::timestamptz
        ),
        (
            '018f0e8f-1000-7000-8000-000000000002'::uuid,
            '2026-01-10T12:00:00Z'::timestamptz,
            '2026-01-13T12:00:00Z'::timestamptz
        )
)
INSERT INTO purchases (
    id,
    tenant_id,
    user_id,
    episode_id,
    price_at_purchase,
    purchased_at,
    expires_at
)
SELECT
    ps.id,
    scope.tenant_id,
    scope.user_id,
    scope.episode_id,
    500,
    ps.purchased_at,
    ps.expires_at
FROM scope
CROSS JOIN purchase_seed ps
ON CONFLICT (id) DO UPDATE
SET user_id = EXCLUDED.user_id,
    episode_id = EXCLUDED.episode_id,
    price_at_purchase = EXCLUDED.price_at_purchase,
    purchased_at = EXCLUDED.purchased_at,
    expires_at = EXCLUDED.expires_at;
