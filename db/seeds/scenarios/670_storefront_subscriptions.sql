-- Scenario: a reader subscribing to a plan on the public site
--
-- `storefront.subscriptions.spec.ts` takes the tenant's payments through the
-- E2E stack's Stripe stand-in from the console, makes the Price the plan below
-- bills on that account, and has the reader find the plan at the gate of an
-- episode it opens, leave Stripe's checkout once and pay it the second time,
-- read the episode, see the plan on My Page, and open the billing portal. The
-- payment settings and the subscription are the tenant's own, so no tenant
-- another suite reads can absorb them.
--
-- Applying it is also how the suite starts over: the tenant is deleted and
-- written again, which takes its payment settings and the reader's
-- subscription with it. Subscriptions restrict the delete of their plan, and
-- the views the reader's reading recorded and the catalog the deletes that
-- would reach them from the tenant, so they go first.
-- public_id values are hard-coded in e2e/src/scenarios/storefront-subscriptions.ts.
--   tenant   SbsfTNNTAAA1 (subs.localhost / admin.subs.localhost)
--   admin    SbsfADMNAAA1 (subs-admin@example.com)
--   reader   SbsfMMBRAAA1 (Plan Reader), who holds nothing yet
--   label    SbsfLABLAAA1 (Night Label), series SbsfSERSAAA1 under it
--   series   SbsfSERSAAA2, under no label
--   episodes SbsfEPSDAAA1 of the first series and SbsfEPSDAAA2 of the second,
--            300 yen each
--   plan     SbsfPLANAAA1 (Night pass), opening the label for 980 yen a month

DELETE FROM subscriptions
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'SbsfTNNTAAA1');

DELETE FROM subscription_checkouts
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'SbsfTNNTAAA1');

DELETE FROM subscription_plans
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'SbsfTNNTAAA1');

DELETE FROM content_events
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'SbsfTNNTAAA1');

DELETE FROM episode_image_variants
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'SbsfTNNTAAA1');

DELETE FROM episode_images
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'SbsfTNNTAAA1');

DELETE FROM episodes
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'SbsfTNNTAAA1');

DELETE FROM series
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'SbsfTNNTAAA1');

DELETE FROM labels
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'SbsfTNNTAAA1');

DELETE FROM tenants
WHERE public_id = 'SbsfTNNTAAA1';

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
    '018f11a0-0001-7000-8000-000000000001'::uuid,
    'SbsfTNNTAAA1',
    'subs.localhost:' || :'tenant_port',
    'admin.subs.localhost:' || :'tenant_port',
    'Subscriptions Tenant',
    'active',
    'en',
    ARRAY['ja', 'en', 'ko', 'zh-Hans', 'zh-Hant']
);

\set seed_tenant SbsfTNNTAAA1
\ir ../creator_roles.sql

-- The admin and the reader. The password hash is the same as `adminpass` for
-- the admin and `memberpass` for the reader.
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
FROM tenants t
CROSS JOIN (
    VALUES
        (
            '018f11a0-0002-7000-8000-000000000001'::uuid,
            'SbsfADMNAAA1',
            'subs-admin@example.com',
            '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
            'Subscriptions E2E Admin'
        ),
        (
            '018f11a0-0002-7000-8000-000000000002'::uuid,
            'SbsfMMBRAAA1',
            'subs-reader@example.com',
            '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
            'Plan Reader'
        )
) AS u(id, public_id, email, password_hash, name)
WHERE t.public_id = 'SbsfTNNTAAA1';

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
SELECT
    '018f11a0-0003-7000-8000-000000000001'::uuid,
    u.id,
    'tenant_admin',
    u.tenant_id
FROM users u
WHERE u.public_id = 'SbsfADMNAAA1';

INSERT INTO labels (id, tenant_id, public_id, name)
SELECT
    '018f11a0-0004-7000-8000-000000000001'::uuid,
    t.id,
    'SbsfLABLAAA1',
    'Night Label'
FROM tenants t
WHERE t.public_id = 'SbsfTNNTAAA1';

-- One series under the label the plan opens, and one under no label, which
-- the plan leaves for sale by the episode.
INSERT INTO series (id, tenant_id, label_id, public_id, is_published, published_at)
SELECT
    s.id,
    t.id,
    s.label_id,
    s.public_id,
    true,
    '2026-01-01T00:00:00Z'::timestamptz
FROM tenants t
CROSS JOIN (
    VALUES
        (
            '018f11a0-0005-7000-8000-000000000001'::uuid,
            '018f11a0-0004-7000-8000-000000000001'::uuid,
            'SbsfSERSAAA1'
        ),
        (
            '018f11a0-0005-7000-8000-000000000002'::uuid,
            NULL::uuid,
            'SbsfSERSAAA2'
        )
) AS s(id, label_id, public_id)
WHERE t.public_id = 'SbsfTNNTAAA1';

INSERT INTO series_translations (id, series_id, tenant_id, locale, title, synopsis)
SELECT
    ('018f11a0-0006-7000-8000-' || right(s.id::text, 12))::uuid,
    s.id,
    s.tenant_id,
    t.default_locale,
    CASE s.public_id
        WHEN 'SbsfSERSAAA1' THEN 'Night Series 001'
        ELSE 'Day Series 001'
    END,
    ''
FROM series s
JOIN tenants t ON t.id = s.tenant_id
WHERE t.public_id = 'SbsfTNNTAAA1';

INSERT INTO episodes (id, series_id, public_id, order_index, tenant_id)
SELECT
    ('018f11a0-0007-7000-8000-' || right(s.id::text, 12))::uuid,
    s.id,
    CASE s.public_id
        WHEN 'SbsfSERSAAA1' THEN 'SbsfEPSDAAA1'
        ELSE 'SbsfEPSDAAA2'
    END,
    1,
    s.tenant_id
FROM series s
JOIN tenants t ON t.id = s.tenant_id
WHERE t.public_id = 'SbsfTNNTAAA1';

INSERT INTO episode_translations (id, episode_id, tenant_id, locale, title)
SELECT
    ('018f11a0-0008-7000-8000-' || right(e.id::text, 12))::uuid,
    e.id,
    e.tenant_id,
    t.default_locale,
    CASE e.public_id
        WHEN 'SbsfEPSDAAA1' THEN 'Night Episode 001-01'
        ELSE 'Day Episode 001-01'
    END
FROM episodes e
JOIN tenants t ON t.id = e.tenant_id
WHERE t.public_id = 'SbsfTNNTAAA1';

INSERT INTO episode_listings (
    episode_id,
    price,
    status,
    published_at,
    tenant_id
)
SELECT
    e.id,
    300,
    'published',
    '2026-01-01T00:00:00Z'::timestamptz,
    e.tenant_id
FROM episodes e
JOIN tenants t ON t.id = e.tenant_id
WHERE t.public_id = 'SbsfTNNTAAA1';

-- Three pages of the episode the plan opens, so the viewer has something to
-- draw for the subscriber. The objects are uploaded by
-- `e2e/scripts/upload-episode-pages.sh`, which reads these object keys back
-- out of the database, so the two cannot drift apart.
INSERT INTO episode_images (id, tenant_id, episode_id, display_order)
SELECT
    ('018f11a0-0009-7000-8000-' || lpad(page_number::text, 12, '0'))::uuid,
    e.tenant_id,
    e.id,
    page_number
FROM episodes e
CROSS JOIN generate_series(1, 3) AS page_number
WHERE e.public_id = 'SbsfEPSDAAA1';

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
    ('018f11a0-000a-7000-8000-' || lpad(page_number::text, 12, '0'))::uuid,
    e.tenant_id,
    ('018f11a0-0009-7000-8000-' || lpad(page_number::text, 12, '0'))::uuid,
    'original',
    's3',
    'tenants/SbsfTNNTAAA1/episodes/'
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
WHERE e.public_id = 'SbsfEPSDAAA1';

-- The plan of the label. Its Price is made on the tenant's Stripe account by
-- the suite, which writes the id it answers over this placeholder: every run
-- takes payments under a secret key of its own.
INSERT INTO subscription_plans (
    id,
    tenant_id,
    public_id,
    name,
    description,
    stripe_price_id,
    price_amount,
    currency,
    recurring_interval,
    recurring_interval_count,
    scope,
    is_published
)
SELECT
    '018f11a0-000b-7000-8000-000000000001'::uuid,
    t.id,
    'SbsfPLANAAA1',
    'Night pass',
    'Every episode of the Night Label, every month.',
    'price_storefront_subscriptions_e2e',
    980,
    'JPY',
    'month',
    1,
    'label',
    true
FROM tenants t
WHERE t.public_id = 'SbsfTNNTAAA1';

INSERT INTO subscription_plan_targets (tenant_id, plan_id, label_id)
SELECT
    p.tenant_id,
    p.id,
    '018f11a0-0004-7000-8000-000000000001'::uuid
FROM subscription_plans p
WHERE p.public_id = 'SbsfPLANAAA1';
