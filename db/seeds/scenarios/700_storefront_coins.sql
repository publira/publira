-- Scenario: readers paying for episodes with a tenant's coins on the public site
--
-- `storefront.coins.spec.ts` lets tenants issue coins from the Platform
-- Console, takes the coins tenant's payments through the E2E stack's Stripe
-- stand-in from the console, and has one reader pay for an episode with the
-- coins they hold and another, who holds none, buy the pack that covers it at
-- the gate, come back to the episode, and pay with its coins. A second tenant
-- has saved its coin settings without turning them on, and its reader sees
-- the gate and the account as they are without coins. The coins, the payment
-- settings, and the purchases are these tenants' own, so no tenant another
-- suite reads can absorb them.
--
-- Applying it is also how the suite starts over: both tenants are deleted and
-- written again, which takes their coin settings, every grant and spend, and
-- every purchase with them. The coin ledger, the purchases it refers to, the
-- views the readers' reading recorded, and the catalog restrict the deletes
-- that would reach them from the tenant, so they go first.
-- public_id values are hard-coded in e2e/src/scenarios/storefront-coins.ts.
--   tenant   CoinTNNTAAA1 (coins.localhost / admin.coins.localhost, Harbor Press), whose
--            coins are Points in `en` and ポイント in `ja`, worth 10 yen each,
--            spendable for 180 days
--   admin    CoinADMNAAA1 (coins-admin@example.com)
--   readers  CoinMMBRAAA1 (Coin Holder), who holds 100 Points, and
--            CoinMMBRAAA2 (Coin Buyer), who holds none
--   series   CoinSERSAAA1, with CoinEPSDAAA1 and CoinEPSDAAA2 at 300 yen
--            (30 Points) each
--   packs    CoinPACKAAA1 (20 Points, 200 yen), CoinPACKAAA2 (50 Points,
--            500 yen), CoinPACKAAA3 (100 Points and 20 bonus, 1,000 yen)
--   tenant   CoffTNNTAAA1 (coins-off.localhost, Quiet Press), whose coin
--            settings are saved and off
--   reader   CoffMMBRAAA1 (Coinless Reader)
--   series   CoffSERSAAA1, with CoffEPSDAAA1 at 300 yen

DELETE FROM coin_spend_allocations
WHERE tenant_id IN (
    SELECT id FROM tenants WHERE public_id IN ('CoinTNNTAAA1', 'CoffTNNTAAA1')
);

DELETE FROM coin_transactions
WHERE tenant_id IN (
    SELECT id FROM tenants WHERE public_id IN ('CoinTNNTAAA1', 'CoffTNNTAAA1')
);

DELETE FROM coin_grants
WHERE tenant_id IN (
    SELECT id FROM tenants WHERE public_id IN ('CoinTNNTAAA1', 'CoffTNNTAAA1')
);

DELETE FROM coin_pack_purchases
WHERE tenant_id IN (
    SELECT id FROM tenants WHERE public_id IN ('CoinTNNTAAA1', 'CoffTNNTAAA1')
);

DELETE FROM purchases
WHERE tenant_id IN (
    SELECT id FROM tenants WHERE public_id IN ('CoinTNNTAAA1', 'CoffTNNTAAA1')
);

DELETE FROM content_events
WHERE tenant_id IN (
    SELECT id FROM tenants WHERE public_id IN ('CoinTNNTAAA1', 'CoffTNNTAAA1')
);

DELETE FROM episode_image_variants
WHERE tenant_id IN (
    SELECT id FROM tenants WHERE public_id IN ('CoinTNNTAAA1', 'CoffTNNTAAA1')
);

DELETE FROM episode_images
WHERE tenant_id IN (
    SELECT id FROM tenants WHERE public_id IN ('CoinTNNTAAA1', 'CoffTNNTAAA1')
);

DELETE FROM episodes
WHERE tenant_id IN (
    SELECT id FROM tenants WHERE public_id IN ('CoinTNNTAAA1', 'CoffTNNTAAA1')
);

DELETE FROM series
WHERE tenant_id IN (
    SELECT id FROM tenants WHERE public_id IN ('CoinTNNTAAA1', 'CoffTNNTAAA1')
);

DELETE FROM tenants
WHERE public_id IN ('CoinTNNTAAA1', 'CoffTNNTAAA1');

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
VALUES
    (
        '018f1710-0001-7000-8000-000000000001'::uuid,
        'CoinTNNTAAA1',
        'coins.localhost:' || :'tenant_port',
        'admin.coins.localhost:' || :'tenant_port',
        'Harbor Press',
        'active',
        'en',
        ARRAY['ja', 'en', 'ko', 'zh-Hans', 'zh-Hant']
    ),
    (
        '018f1710-0001-7000-8000-000000000002'::uuid,
        'CoffTNNTAAA1',
        'coins-off.localhost:' || :'tenant_port',
        'admin.coins-off.localhost:' || :'tenant_port',
        'Quiet Press',
        'active',
        'en',
        ARRAY['ja', 'en', 'ko', 'zh-Hans', 'zh-Hant']
    );

\set seed_tenant CoinTNNTAAA1
\ir ../creator_roles.sql
\set seed_tenant CoffTNNTAAA1
\ir ../creator_roles.sql

-- The admin and the readers. The password hash is the same as `adminpass` for
-- the admin and `memberpass` for the readers.
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
            '018f1710-0002-7000-8000-000000000001'::uuid,
            'CoinTNNTAAA1',
            'CoinADMNAAA1',
            'coins-admin@example.com',
            '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
            'Coins E2E Admin'
        ),
        (
            '018f1710-0002-7000-8000-000000000002'::uuid,
            'CoinTNNTAAA1',
            'CoinMMBRAAA1',
            'coins-holder@example.com',
            '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
            'Coin Holder'
        ),
        (
            '018f1710-0002-7000-8000-000000000003'::uuid,
            'CoinTNNTAAA1',
            'CoinMMBRAAA2',
            'coins-buyer@example.com',
            '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
            'Coin Buyer'
        ),
        (
            '018f1710-0002-7000-8000-000000000004'::uuid,
            'CoffTNNTAAA1',
            'CoffMMBRAAA1',
            'coins-off-reader@example.com',
            '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
            'Coinless Reader'
        )
) AS u(id, tenant_public_id, public_id, email, password_hash, name)
JOIN tenants t ON t.public_id = u.tenant_public_id;

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
SELECT
    '018f1710-0003-7000-8000-000000000001'::uuid,
    u.id,
    'tenant_admin',
    u.tenant_id
FROM users u
WHERE u.public_id = 'CoinADMNAAA1';

INSERT INTO series (id, tenant_id, public_id, is_published, published_at)
SELECT
    s.id,
    t.id,
    s.public_id,
    true,
    '2026-01-01T00:00:00Z'::timestamptz
FROM (
    VALUES
        ('018f1710-0004-7000-8000-000000000001'::uuid, 'CoinTNNTAAA1', 'CoinSERSAAA1'),
        ('018f1710-0004-7000-8000-000000000002'::uuid, 'CoffTNNTAAA1', 'CoffSERSAAA1')
) AS s(id, tenant_public_id, public_id)
JOIN tenants t ON t.public_id = s.tenant_public_id;

INSERT INTO series_translations (id, series_id, tenant_id, locale, title, synopsis)
SELECT
    ('018f1710-0005-7000-8000-' || right(s.id::text, 12))::uuid,
    s.id,
    s.tenant_id,
    'en',
    CASE s.public_id
        WHEN 'CoinSERSAAA1' THEN 'Harbor Lights'
        ELSE 'Quiet Streets'
    END,
    ''
FROM series s
WHERE s.public_id IN ('CoinSERSAAA1', 'CoffSERSAAA1');

INSERT INTO episodes (id, series_id, public_id, order_index, tenant_id)
SELECT
    e.id,
    s.id,
    e.public_id,
    e.order_index,
    s.tenant_id
FROM (
    VALUES
        ('018f1710-0006-7000-8000-000000000001'::uuid, 'CoinSERSAAA1', 'CoinEPSDAAA1', 1),
        ('018f1710-0006-7000-8000-000000000002'::uuid, 'CoinSERSAAA1', 'CoinEPSDAAA2', 2),
        ('018f1710-0006-7000-8000-000000000003'::uuid, 'CoffSERSAAA1', 'CoffEPSDAAA1', 1)
) AS e(id, series_public_id, public_id, order_index)
JOIN series s ON s.public_id = e.series_public_id;

INSERT INTO episode_translations (id, episode_id, tenant_id, locale, title)
SELECT
    ('018f1710-0007-7000-8000-' || right(e.id::text, 12))::uuid,
    e.id,
    e.tenant_id,
    'en',
    CASE e.public_id
        WHEN 'CoinEPSDAAA1' THEN 'The First Light'
        WHEN 'CoinEPSDAAA2' THEN 'The Second Light'
        ELSE 'The First Street'
    END
FROM episodes e
WHERE e.public_id IN ('CoinEPSDAAA1', 'CoinEPSDAAA2', 'CoffEPSDAAA1');

INSERT INTO episode_listings (
    episode_id,
    price,
    reading_period_hours,
    status,
    published_at,
    tenant_id
)
SELECT
    e.id,
    300,
    72,
    'published',
    '2026-01-01T00:00:00Z'::timestamptz,
    e.tenant_id
FROM episodes e
WHERE e.public_id IN ('CoinEPSDAAA1', 'CoinEPSDAAA2', 'CoffEPSDAAA1');

-- Three pages of each episode of the coins tenant, so the viewer has
-- something to draw once a reader pays. The objects are uploaded by
-- `e2e/scripts/upload-episode-pages.sh`, which reads these object keys back
-- out of the database, so the two cannot drift apart.
INSERT INTO episode_images (id, tenant_id, episode_id, display_order)
SELECT
    ('018f1710-0008-7000-8000-' || lpad((e.order_index * 10 + page_number)::text, 12, '0'))::uuid,
    e.tenant_id,
    e.id,
    page_number
FROM episodes e
CROSS JOIN generate_series(1, 3) AS page_number
WHERE e.public_id IN ('CoinEPSDAAA1', 'CoinEPSDAAA2');

INSERT INTO episode_image_variants (
    id,
    tenant_id,
    episode_image_id,
    label,
    storage_provider,
    object_key,
    content_type,
    file_size_bytes,
    width,
    height
)
SELECT
    ('018f1710-0009-7000-8000-' || lpad((e.order_index * 10 + page_number)::text, 12, '0'))::uuid,
    e.tenant_id,
    ('018f1710-0008-7000-8000-' || lpad((e.order_index * 10 + page_number)::text, 12, '0'))::uuid,
    'original',
    's3',
    'tenants/CoinTNNTAAA1/episodes/'
        || e.public_id
        || '/page-'
        || lpad(page_number::text, 2, '0')
        || '-original.jpg',
    'image/jpeg',
    120000,
    -- db/seeds/objects/episode-page/page-NN.jpg
    1050,
    1500
FROM episodes e
CROSS JOIN generate_series(1, 3) AS page_number
WHERE e.public_id IN ('CoinEPSDAAA1', 'CoinEPSDAAA2');

-- The coins tenant has turned its coins on and sells three packs; the other
-- has saved the same settings and left them off. Neither is offered to a
-- reader until the platform allows tenants to issue coins, which the suite
-- turns on from the Platform Console.
INSERT INTO tenant_coin_config (
    tenant_id,
    enabled,
    selling,
    coin_unit_amount,
    expiry_days,
    issuer_name,
    terms_url,
    contact,
    notice
)
SELECT
    t.id,
    t.public_id = 'CoinTNNTAAA1',
    true,
    10,
    180,
    'Harbor Press Ltd.',
    'https://example.com/points-terms',
    'points@example.com',
    'Refunds are made only where the law requires them.'
FROM tenants t
WHERE t.public_id IN ('CoinTNNTAAA1', 'CoffTNNTAAA1');

INSERT INTO tenant_coin_name_translations (id, tenant_id, locale, name)
SELECT
    n.id,
    t.id,
    n.locale,
    n.name
FROM (
    VALUES
        ('018f1710-000a-7000-8000-000000000001'::uuid, 'CoinTNNTAAA1', 'en', 'Points'),
        ('018f1710-000a-7000-8000-000000000002'::uuid, 'CoinTNNTAAA1', 'ja', 'ポイント'),
        ('018f1710-000a-7000-8000-000000000003'::uuid, 'CoffTNNTAAA1', 'en', 'Points')
) AS n(id, tenant_public_id, locale, name)
JOIN tenants t ON t.public_id = n.tenant_public_id;

INSERT INTO tenant_coin_packs (
    id,
    tenant_id,
    public_id,
    coins,
    bonus_coins,
    price,
    sort_order,
    on_sale
)
SELECT
    p.id,
    t.id,
    p.public_id,
    p.coins,
    p.bonus_coins,
    p.price,
    p.sort_order,
    true
FROM (
    VALUES
        ('018f1710-000b-7000-8000-000000000001'::uuid, 'CoinPACKAAA1', 20, 0, 200, 0),
        ('018f1710-000b-7000-8000-000000000002'::uuid, 'CoinPACKAAA2', 50, 0, 500, 1),
        ('018f1710-000b-7000-8000-000000000003'::uuid, 'CoinPACKAAA3', 100, 20, 1000, 2)
) AS p(id, public_id, coins, bonus_coins, price, sort_order)
CROSS JOIN tenants t
WHERE t.public_id = 'CoinTNNTAAA1';

-- The holder's 100 Points, granted by staff.
INSERT INTO coin_grants (
    id,
    tenant_id,
    user_id,
    source,
    coins,
    remaining_coins,
    expires_at,
    granted_at
)
SELECT
    '018f1710-000c-7000-8000-000000000001'::uuid,
    u.tenant_id,
    u.id,
    'staff',
    100,
    100,
    '2036-03-30T15:00:00Z'::timestamptz,
    '2026-10-01T00:00:00Z'::timestamptz
FROM users u
WHERE u.public_id = 'CoinMMBRAAA1';

INSERT INTO coin_transactions (id, tenant_id, user_id, kind, coins, grant_id, created_at)
SELECT
    '018f1710-000d-7000-8000-000000000001'::uuid,
    g.tenant_id,
    g.user_id,
    'grant',
    g.coins,
    g.id,
    g.granted_at
FROM coin_grants g
WHERE g.id = '018f1710-000c-7000-8000-000000000001'::uuid;
