-- Scenario: a tenant editor and a reader with no grant, reading on the storefront
--
-- `storefront.staff-episode-access.spec.ts` signs in to the development seed
-- tenant's site as each of them and asserts what the priced `Seed Episode
-- 001-10` shows: the editor reads its pages and is told they are open through
-- the role, and the reader meets the gate. The dev seed member holds a
-- purchase of the episode, so it is the suite's buyer. The editor holds no
-- purchase or ticket, so the role is the only thing that can open the episode
-- to it.
-- Password hash matches the dev seed (`memberpass`). public_id values are
-- hard-coded in e2e/src/scenarios/staff-reader.ts.
--   editor StfrEDTRAAA1 (staff-reader-editor@example.com)
--   reader StfrMMBRAAA1 (staff-reader-member@example.com)

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
    seed.id,
    t.id,
    seed.public_id,
    seed.email,
    '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
    seed.name,
    'active',
    NOW()
FROM (
    VALUES
        (
            '018f1170-0001-7000-8000-000000000001'::uuid,
            'StfrEDTRAAA1',
            'staff-reader-editor@example.com',
            'Staff Reader Editor'
        ),
        (
            '018f1170-0001-7000-8000-000000000002'::uuid,
            'StfrMMBRAAA1',
            'staff-reader-member@example.com',
            'Staff Reader Member'
        )
) AS seed (id, public_id, email, name)
JOIN tenants t ON t.public_id = 'SeedTNNTAAA1'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    email_verified_at = EXCLUDED.email_verified_at;

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
SELECT
    '018f1170-0002-7000-8000-000000000001'::uuid,
    u.id,
    'tenant_editor',
    u.tenant_id
FROM users u
WHERE u.public_id = 'StfrEDTRAAA1'
ON CONFLICT (user_id, role) DO NOTHING;
