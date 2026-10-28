-- Scenario: a tenant whose search engine verification codes the E2E may change
--
-- `admin.site-verification.spec.ts` saves the codes from `/settings` and opens
-- the tenant's site to find them in every page's <head>. The codes are one
-- setting for a whole tenant, and every page of its site carries them, so a
-- tenant of its own keeps another suite's pages, and the documentation's
-- screenshots of the development seed tenant, from carrying a code saved here.
-- An editor of the same tenant sees the card read-only.
--
-- Applying it is also how the suite starts over: the tenant is deleted and
-- written again, which takes the codes and the audit entries of the saves with
-- it.
-- Password hashes match the dev seed (`adminpass`).
-- public_id values are hard-coded in e2e/src/scenarios/site-verification.ts.
--   tenant VrfyTNNTAAA1 (verify.localhost / admin.verify.localhost)
--   admin  VrfyADMNAAA1 (verify-admin@example.com)
--   editor VrfyEDTRAAA1 (verify-editor@example.com)

-- A tenant's audit entries hold its deletion back, so they go first.
DELETE FROM audit_logs
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'VrfyTNNTAAA1');

DELETE FROM tenants
WHERE public_id = 'VrfyTNNTAAA1';

INSERT INTO tenants (
    id,
    public_id,
    domain,
    admin_domain,
    name,
    status,
    default_locale,
    supported_locales
)
VALUES (
    '018f1160-0001-7000-8000-000000000001'::uuid,
    'VrfyTNNTAAA1',
    'verify.localhost:' || :'tenant_port',
    'admin.verify.localhost:' || :'tenant_port',
    'Site Verification Tenant',
    'active',
    'en',
    ARRAY['ja', 'en', 'ko', 'zh-Hans', 'zh-Hant']
);

\set seed_tenant VrfyTNNTAAA1
\ir ../creator_roles.sql

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
    '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
    seed.name,
    'active',
    NOW()
FROM (
    VALUES
        (
            '018f1160-0002-7000-8000-000000000001'::uuid,
            'VrfyADMNAAA1',
            'verify-admin@example.com',
            'Site Verification E2E Admin'
        ),
        (
            '018f1160-0002-7000-8000-000000000002'::uuid,
            'VrfyEDTRAAA1',
            'verify-editor@example.com',
            'Site Verification E2E Editor'
        )
) AS seed (id, public_id, email, name)
JOIN tenants t ON t.public_id = 'VrfyTNNTAAA1';

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
SELECT seed.id, u.id, seed.role, u.tenant_id
FROM (
    VALUES
        (
            '018f1160-0003-7000-8000-000000000001'::uuid,
            'VrfyADMNAAA1',
            'tenant_admin'
        ),
        (
            '018f1160-0003-7000-8000-000000000002'::uuid,
            'VrfyEDTRAAA1',
            'tenant_editor'
        )
) AS seed (id, public_id, role)
JOIN users u ON u.public_id = seed.public_id;
