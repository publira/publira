-- Scenario: a tenant administrator setting up coins from the tenant console
--
-- `admin.coin-settings.spec.ts` lets tenants issue coins from the Platform
-- Console, takes this tenant's payments through the E2E stack's Stripe
-- stand-in, and has its administrator name the coin, fill in the
-- disclosures, add packs, and turn coins on, stop selling, and try to turn
-- them off, from a tenant that has saved nothing about coins. An editor of
-- the same tenant, and an auditor, are answered not found on the screen. The tenant, its
-- payments, and its coins are its own, so no tenant another suite reads can
-- absorb them.
--
-- Applying it is also how the suite starts over: the tenant is deleted and
-- written again, which takes its coin settings, its packs, and every grant
-- with them. The coin ledger restricts the delete that would reach it from
-- the tenant, so it goes first.
-- public_id values are hard-coded in e2e/src/scenarios/admin-coin-settings.ts.
--   tenant   CsetTNNTAAA1 (coin-settings.localhost /
--            admin.coin-settings.localhost, Lantern Press), offered in `en`
--            and `ja`, with no coin settings saved
--   admin    CsetADMNAAA1 (coin-settings-admin@example.com)
--   editor   CsetEDTRAAA1 (coin-settings-editor@example.com)
--   auditor  CsetAUDTAAA1 (coin-settings-auditor@example.com)
--   reader   CsetMMBRAAA1 (Coin Keeper), who holds no coins until
--            `711_admin_coin_settings_holder.sql` grants them

DELETE FROM coin_spend_allocations
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'CsetTNNTAAA1');

DELETE FROM coin_transactions
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'CsetTNNTAAA1');

DELETE FROM coin_grants
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'CsetTNNTAAA1');

DELETE FROM coin_pack_purchases
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'CsetTNNTAAA1');

DELETE FROM purchases
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'CsetTNNTAAA1');

-- A tenant's audit entries hold its deletion back, so they go first.
DELETE FROM audit_logs
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'CsetTNNTAAA1');

DELETE FROM tenants
WHERE public_id = 'CsetTNNTAAA1';

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
    '018f1720-0001-7000-8000-000000000001'::uuid,
    'CsetTNNTAAA1',
    'coin-settings.localhost:' || :'tenant_port',
    'admin.coin-settings.localhost:' || :'tenant_port',
    'Lantern Press',
    'active',
    'en',
    ARRAY['en', 'ja']
);

\set seed_tenant CsetTNNTAAA1
\ir ../creator_roles.sql

-- The password hash is the same as `adminpass` for the staff and
-- `memberpass` for the reader.
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
    u.id,
    t.id,
    u.public_id,
    u.email,
    u.password_hash,
    u.name,
    'active',
    NOW()
FROM (
    VALUES
        (
            '018f1720-0002-7000-8000-000000000001'::uuid,
            'CsetADMNAAA1',
            'coin-settings-admin@example.com',
            '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
            'Coin Settings Admin'
        ),
        (
            '018f1720-0002-7000-8000-000000000002'::uuid,
            'CsetEDTRAAA1',
            'coin-settings-editor@example.com',
            '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
            'Coin Settings Editor'
        ),
        (
            '018f1720-0002-7000-8000-000000000004'::uuid,
            'CsetAUDTAAA1',
            'coin-settings-auditor@example.com',
            '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
            'Coin Settings Auditor'
        ),
        (
            '018f1720-0002-7000-8000-000000000003'::uuid,
            'CsetMMBRAAA1',
            'coin-settings-reader@example.com',
            '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
            'Coin Keeper'
        )
) AS u(id, public_id, email, password_hash, name)
CROSS JOIN tenants t
WHERE t.public_id = 'CsetTNNTAAA1';

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
SELECT
    r.id,
    u.id,
    r.role,
    u.tenant_id
FROM (
    VALUES
        ('018f1720-0003-7000-8000-000000000001'::uuid, 'CsetADMNAAA1', 'tenant_admin'),
        ('018f1720-0003-7000-8000-000000000002'::uuid, 'CsetEDTRAAA1', 'tenant_editor'),
        ('018f1720-0003-7000-8000-000000000003'::uuid, 'CsetAUDTAAA1', 'tenant_auditor')
) AS r(id, public_id, role)
JOIN users u ON u.public_id = r.public_id;
