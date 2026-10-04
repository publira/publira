-- Scenario: a tenant whose refused email addresses the E2E may change
--
-- `admin.email-rejection.spec.ts` switches the disposable-domain list on from
-- `/settings`, lists a domain of its own, and then signs readers up on the
-- storefront to see them refused. The setting is one for a whole tenant, so a
-- tenant whose sign-up another suite drives cannot absorb it. An editor of the
-- same tenant sees the setting read-only.
--
-- Applying it is also how the suite starts over: the tenant is deleted and
-- written again, which takes the setting, the accounts the sign-ups created,
-- and the audit entries of the saves with it.
-- Password hashes match the dev seed (`adminpass`).
-- public_id values are hard-coded in e2e/src/scenarios/email-rejection.ts.
--   tenant RjctTNNTAAA1 (reject.localhost / admin.reject.localhost)
--   admin  RjctADMNAAA1 (reject-admin@example.com)
--   editor RjctEDTRAAA1 (reject-editor@example.com)

DELETE FROM tenants
WHERE public_id = 'RjctTNNTAAA1';

INSERT INTO tenants (
    id,
    public_id,
    domain,
    admin_domain,
    name,
    status,
    default_locale
)
VALUES (
    '018f1060-0001-7000-8000-000000000001'::uuid,
    'RjctTNNTAAA1',
    'reject.localhost:' || :'tenant_port',
    'admin.reject.localhost:' || :'tenant_port',
    'Email Rejection Tenant',
    'active',
    'en'
);

\set seed_tenant RjctTNNTAAA1
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
            '018f1060-0002-7000-8000-000000000001'::uuid,
            'RjctADMNAAA1',
            'reject-admin@example.com',
            'Email Rejection E2E Admin'
        ),
        (
            '018f1060-0002-7000-8000-000000000002'::uuid,
            'RjctEDTRAAA1',
            'reject-editor@example.com',
            'Email Rejection E2E Editor'
        )
) AS seed (id, public_id, email, name)
JOIN tenants t ON t.public_id = 'RjctTNNTAAA1';

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
SELECT seed.id, u.id, seed.role, u.tenant_id
FROM (
    VALUES
        (
            '018f1060-0003-7000-8000-000000000001'::uuid,
            'RjctADMNAAA1',
            'tenant_admin'
        ),
        (
            '018f1060-0003-7000-8000-000000000002'::uuid,
            'RjctEDTRAAA1',
            'tenant_editor'
        )
) AS seed (id, public_id, role)
JOIN users u ON u.public_id = seed.public_id;
