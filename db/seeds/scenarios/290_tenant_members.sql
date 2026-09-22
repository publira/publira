-- Scenario: a tenant whose console members the E2E invites, promotes, and demotes
--
-- `admin.tenant-members.spec.ts` invites a tenant admin from
-- `/members`, accepts the invitation, and makes the tenant's editor an
-- admin on the spot. Who administers a tenant decides who can sign in to its
-- console as what, so no tenant another suite signs in to can absorb it.
--
-- Applying it is also how the suite starts over: the tenant is deleted and
-- written again, which takes the account the invitation created, the
-- invitations, the roles the suite changed, and their audit entries with it.
-- public_id values are hard-coded in e2e/src/scenarios/tenant-members.ts.
--   tenant TmbrTNNTAAA1 (team.localhost / admin.team.localhost)
--   admin  TmbrADMNAAA1 (team-admin@example.com)
--   editor TmbrEDTRAAA1 (team-editor@example.com)

DELETE FROM tenants
WHERE public_id = 'TmbrTNNTAAA1';

WITH tenant_seed AS (
    SELECT '018f0fe0-0001-7000-8000-000000000001'::uuid AS id
)
INSERT INTO tenants (
    id,
    public_id,
    domain,
    admin_domain,
    name,
    status,
    default_locale
)
SELECT
    ts.id,
    'TmbrTNNTAAA1',
    'team.localhost',
    'admin.team.localhost',
    'Team Tenant',
    'active',
    'en'
FROM tenant_seed ts;

\set seed_tenant TmbrTNNTAAA1
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
            '018f0fe0-0002-7000-8000-000000000001'::uuid,
            'TmbrADMNAAA1',
            'team-admin@example.com',
            'Team E2E Admin'
        ),
        (
            '018f0fe0-0002-7000-8000-000000000002'::uuid,
            'TmbrEDTRAAA1',
            'team-editor@example.com',
            'Team E2E Editor'
        )
) AS seed (id, public_id, email, name)
JOIN tenants t ON t.public_id = 'TmbrTNNTAAA1';

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
SELECT seed.id, u.id, seed.role, u.tenant_id
FROM (
    VALUES
        (
            '018f0fe0-0003-7000-8000-000000000001'::uuid,
            'TmbrADMNAAA1',
            'tenant_admin'
        ),
        (
            '018f0fe0-0003-7000-8000-000000000002'::uuid,
            'TmbrEDTRAAA1',
            'tenant_editor'
        )
) AS seed (id, public_id, role)
JOIN users u ON u.public_id = seed.public_id;
