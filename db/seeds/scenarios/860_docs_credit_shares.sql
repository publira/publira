-- Scenario: what an Editor is shown of the shares on a credit
--
-- The page under docs/<locale>/4-console/ about reports and royalties explains
-- what an Editor sees of a share they may not change, and the royalty tenant,
-- RoyaTNNTAAA1, which 260_royalties.sql creates and this file needs first,
-- has an admin alone and a series that credits nobody. This file adds an
-- Editor of that tenant and credits its series to the episode's two Authors,
-- one paid a share and one paid nothing, so the series form shows an Editor
-- both kinds of credit, and the episode, credited 30% and 20% by that file,
-- shows them two paid ones.
--
-- Applied by e2e/tests/admin.docs-screenshots.setup.ts, after
-- 260_royalties.sql. The royalties suite applies that file again before it
-- runs, which deletes the tenant with everything written here, so this file
-- writes its rows only where they are missing and can be applied any number of
-- times.
--
--   editor  RoyaEDTRAAA1 (royalty-editor@example.com / adminpass)
--   series  RoyaSERSAAA1 credits RoyaAUTHAAA2 (Original Author, 0%) and
--           RoyaAUTHAAA1 (Artist, 30%)

BEGIN;

INSERT INTO users (
    id,
    tenant_id,
    public_id,
    email,
    password_hash,
    name,
    status,
    email_verified_at
)
SELECT
    '018f0f80-0860-7000-8000-000000000001'::uuid,
    t.id,
    'RoyaEDTRAAA1',
    'royalty-editor@example.com',
    '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
    'Royalty E2E Editor',
    'active',
    '2026-01-01T00:00:00Z'::timestamptz
FROM tenants t
WHERE t.public_id = 'RoyaTNNTAAA1'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    email_verified_at = EXCLUDED.email_verified_at;

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
SELECT
    '018f0f80-0860-7000-8000-000000000002'::uuid,
    u.id,
    'tenant_editor',
    u.tenant_id
FROM users u
WHERE u.public_id = 'RoyaEDTRAAA1'
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO series_creators (
    series_id,
    creator_id,
    role_id,
    display_order,
    tenant_id,
    share_bps
)
SELECT
    s.id,
    c.id,
    r.id,
    credit.display_order,
    s.tenant_id,
    credit.share_bps
FROM series s
CROSS JOIN (
    VALUES ('RoyaAUTHAAA2', 'Original Author', 1, 0),
        ('RoyaAUTHAAA1', 'Artist', 1, 3000)
) AS credit(creator_public_id, role_name, display_order, share_bps)
JOIN creators c ON c.public_id = credit.creator_public_id
JOIN creator_roles r ON r.tenant_id = s.tenant_id AND r.name = credit.role_name
WHERE s.public_id = 'RoyaSERSAAA1'
ON CONFLICT (series_id, creator_id, role_id) DO UPDATE
SET display_order = EXCLUDED.display_order,
    tenant_id = EXCLUDED.tenant_id,
    share_bps = EXCLUDED.share_bps;

COMMIT;
