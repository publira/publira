-- The member follows Seed Series 011 and its author, and only the author of
-- Seed Series 070, so My Page's follow updates show both branches and an
-- episode reached twice listed once. The two all-ages series share a publish
-- day eight days back, so their newest episodes interleave and are all past.

WITH scope AS (
    SELECT
        t.id AS tenant_id,
        u.id AS user_id
    FROM tenants t
    JOIN users u ON u.tenant_id = t.id AND u.email = 'member@example.com'
    WHERE t.domain = 'localhost'
)
INSERT INTO series_follows (tenant_id, user_id, series_id)
SELECT
    scope.tenant_id,
    scope.user_id,
    s.id
FROM scope
JOIN series s ON s.tenant_id = scope.tenant_id AND s.public_id = 'SeedSERSAA11'
ON CONFLICT (tenant_id, user_id, series_id) DO NOTHING;

WITH scope AS (
    SELECT
        t.id AS tenant_id,
        u.id AS user_id
    FROM tenants t
    JOIN users u ON u.tenant_id = t.id AND u.email = 'member@example.com'
    WHERE t.domain = 'localhost'
)
INSERT INTO creator_follows (tenant_id, user_id, creator_id)
SELECT
    scope.tenant_id,
    scope.user_id,
    c.id
FROM scope
JOIN creators c ON c.tenant_id = scope.tenant_id
    AND c.public_id IN ('SeedAUTHAA11', 'SeedAUTHAA7A')
ON CONFLICT (tenant_id, user_id, creator_id) DO NOTHING;
