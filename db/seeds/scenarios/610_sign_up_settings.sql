-- Scenario: a tenant whose reader sign-up the E2E may close
--
-- `admin.sign-up-settings.spec.ts` closes sign-up from `/settings`, opens the
-- tenant's sign-up page to see its message in place of the form, and opens
-- sign-up again. The setting is one for a whole tenant, and every other
-- suite signs readers up on a tenant of its own or the development seed
-- tenant, so a tenant of its own keeps a closed sign-up from refusing theirs.
-- An editor of the same tenant sees the setting read-only.
--
-- Applying it is also how the suite starts over: the tenant is deleted and
-- written again, which takes the setting and the audit entries of the saves
-- with it.
-- Password hashes match the dev seed (`adminpass`).
-- public_id values are hard-coded in e2e/src/scenarios/sign-up-settings.ts.
--   tenant ClsdTNNTAAA1 (closed.localhost / admin.closed.localhost)
--   admin  ClsdADMNAAA1 (sign-up-admin@example.com)
--   editor ClsdEDTRAAA1 (sign-up-editor@example.com)

DELETE FROM tenants
WHERE public_id = 'ClsdTNNTAAA1';

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
    '018f1150-0001-7000-8000-000000000001'::uuid,
    'ClsdTNNTAAA1',
    'closed.localhost:' || :'tenant_port',
    'admin.closed.localhost:' || :'tenant_port',
    'Sign-up Settings Tenant',
    'active',
    'en',
    ARRAY['ja', 'en', 'ko', 'zh-Hans', 'zh-Hant']
);

\set seed_tenant ClsdTNNTAAA1
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
            '018f1150-0002-7000-8000-000000000001'::uuid,
            'ClsdADMNAAA1',
            'sign-up-admin@example.com',
            'Sign-up Settings E2E Admin'
        ),
        (
            '018f1150-0002-7000-8000-000000000002'::uuid,
            'ClsdEDTRAAA1',
            'sign-up-editor@example.com',
            'Sign-up Settings E2E Editor'
        )
) AS seed (id, public_id, email, name)
JOIN tenants t ON t.public_id = 'ClsdTNNTAAA1';

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
SELECT seed.id, u.id, seed.role, u.tenant_id
FROM (
    VALUES
        (
            '018f1150-0003-7000-8000-000000000001'::uuid,
            'ClsdADMNAAA1',
            'tenant_admin'
        ),
        (
            '018f1150-0003-7000-8000-000000000002'::uuid,
            'ClsdEDTRAAA1',
            'tenant_editor'
        )
) AS seed (id, public_id, role)
JOIN users u ON u.public_id = seed.public_id;
