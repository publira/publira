-- Scenario: a tenant with one month of sales and of a subscription payment to
-- close into a royalty statement
--
-- `admin.royalties.spec.ts` reads January 2026 on this tenant's Revenue
-- screen, previews the month, closes it, and reads the statement back,
-- subscription lines included; then it switches the tenant to
-- automatic closing. A close is tenant-wide and never reopened, so no tenant
-- another suite reads can absorb it.
--
-- Applying it is also how the suite starts over. A closed statement refuses
-- every change but the one a deleted tenant makes to it, so the tenant is
-- deleted and written again rather than its statements.
-- public_id values are hard-coded in e2e/src/scenarios/royalties.ts.
--   tenant  RoyaTNNTAAA1 (royalty.localhost / admin.royalty.localhost)
--   admin   RoyaADMNAAA1 (royalty-admin@example.com)
--   series  RoyaSERSAAA1, episode RoyaEPSDAAA1 (500 yen)
--   authors RoyaAUTHAAA1 (Artist, 30%), RoyaAUTHAAA2 (Original Author, 20%)
--   reader  RoyaMMBRAAA1, subscribed to RoyaPLANAAA1 (the whole catalog,
--           980 yen a month)

-- Sales, subscriptions, and the catalog restrict the deletes that would reach
-- them from the tenant, so they go first, in the order deleteTenantsByPublicIds
-- uses.
DELETE FROM purchases
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'RoyaTNNTAAA1');

DELETE FROM subscription_payments
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'RoyaTNNTAAA1');

DELETE FROM subscriptions
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'RoyaTNNTAAA1');

DELETE FROM subscription_plans
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'RoyaTNNTAAA1');

DELETE FROM content_events
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'RoyaTNNTAAA1');

DELETE FROM episodes
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'RoyaTNNTAAA1');

DELETE FROM series
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'RoyaTNNTAAA1');

-- A tenant's audit entries hold its deletion back, so they go first.
DELETE FROM audit_logs
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'RoyaTNNTAAA1');

DELETE FROM tenants
WHERE public_id = 'RoyaTNNTAAA1';

WITH tenant_seed AS (
    SELECT '018f0f80-0001-7000-8000-000000000001'::uuid AS id
)
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
SELECT
    ts.id,
    'RoyaTNNTAAA1',
    'royalty.localhost:' || :'tenant_port',
    'admin.royalty.localhost:' || :'tenant_port',
    'Royalty Tenant',
    'active',
    'en',
    ARRAY['ja', 'en', 'ko', 'zh-Hans', 'zh-Hant']
FROM tenant_seed ts
ON CONFLICT (public_id) DO UPDATE
SET domain = EXCLUDED.domain,
    admin_domain = EXCLUDED.admin_domain,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    default_locale = EXCLUDED.default_locale,
    supported_locales = EXCLUDED.supported_locales;

\set seed_tenant RoyaTNNTAAA1
\ir ../creator_roles.sql

WITH admin_user_seed AS (
    SELECT '018f0f80-0002-7000-8000-000000000001'::uuid AS id
)
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
    aus.id,
    t.id,
    'RoyaADMNAAA1',
    'royalty-admin@example.com',
    '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
    'Royalty E2E Admin',
    'active',
    NOW()
FROM admin_user_seed aus
JOIN tenants t ON t.public_id = 'RoyaTNNTAAA1'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    email_verified_at = EXCLUDED.email_verified_at;

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
SELECT
    '018f0f80-0003-7000-8000-000000000001'::uuid,
    u.id,
    'tenant_admin',
    u.tenant_id
FROM users u
WHERE u.public_id = 'RoyaADMNAAA1'
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO labels (id, tenant_id, public_id, name)
SELECT
    '018f0f80-0004-7000-8000-000000000001'::uuid,
    t.id,
    'RoyaLABLAAA1',
    'Royalty Label 01'
FROM tenants t
WHERE t.public_id = 'RoyaTNNTAAA1'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    name = EXCLUDED.name;

INSERT INTO creators (id, tenant_id, public_id, name, profile_text)
SELECT
    c.id,
    t.id,
    c.public_id,
    c.name,
    ''
FROM tenants t
CROSS JOIN (
    VALUES ('018f0f80-0005-7000-8000-000000000001'::uuid, 'RoyaAUTHAAA1', 'Royalty Artist'),
        ('018f0f80-0005-7000-8000-000000000002'::uuid, 'RoyaAUTHAAA2', 'Royalty Writer')
) AS c(id, public_id, name)
WHERE t.public_id = 'RoyaTNNTAAA1'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    name = EXCLUDED.name;

INSERT INTO series (id, tenant_id, label_id, public_id, is_published, published_at)
SELECT
    '018f0f80-0006-7000-8000-000000000001'::uuid,
    t.id,
    '018f0f80-0004-7000-8000-000000000001'::uuid,
    'RoyaSERSAAA1',
    true,
    '2025-12-01T00:00:00Z'::timestamptz
FROM tenants t
WHERE t.public_id = 'RoyaTNNTAAA1'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    label_id = EXCLUDED.label_id,
    is_published = EXCLUDED.is_published,
    published_at = EXCLUDED.published_at,
    updated_at = NOW();

INSERT INTO series_translations (id, series_id, tenant_id, locale, title, synopsis)
SELECT
    '018f0f80-0009-7000-8000-000000000001'::uuid,
    s.id,
    s.tenant_id,
    t.default_locale,
    'Royalty Series 001',
    ''
FROM series s
JOIN tenants t ON t.id = s.tenant_id
WHERE s.public_id = 'RoyaSERSAAA1'
ON CONFLICT (series_id, locale) DO UPDATE
SET title = EXCLUDED.title,
    synopsis = EXCLUDED.synopsis;

INSERT INTO episodes (id, series_id, public_id, order_index, tenant_id)
SELECT
    '018f0f80-0007-7000-8000-000000000001'::uuid,
    s.id,
    'RoyaEPSDAAA1',
    1,
    s.tenant_id
FROM series s
WHERE s.public_id = 'RoyaSERSAAA1'
ON CONFLICT (public_id) DO UPDATE
SET series_id = EXCLUDED.series_id,
    order_index = EXCLUDED.order_index,
    tenant_id = EXCLUDED.tenant_id;

INSERT INTO episode_translations (id, episode_id, tenant_id, locale, title)
SELECT
    '018f0f80-000a-7000-8000-000000000001'::uuid,
    e.id,
    e.tenant_id,
    t.default_locale,
    'Royalty Episode 001-01'
FROM episodes e
JOIN tenants t ON t.id = e.tenant_id
WHERE e.public_id = 'RoyaEPSDAAA1'
ON CONFLICT (episode_id, locale) DO UPDATE
SET title = EXCLUDED.title;

INSERT INTO episode_listings (
    episode_id,
    price,
    reading_period_hours,
    status,
    scheduled_at,
    published_at,
    tenant_id
)
SELECT
    e.id,
    500,
    72,
    'published',
    NULL::timestamptz,
    '2025-12-01T00:00:00Z'::timestamptz,
    e.tenant_id
FROM episodes e
WHERE e.public_id = 'RoyaEPSDAAA1'
ON CONFLICT (episode_id) DO UPDATE
SET price = EXCLUDED.price,
    reading_period_hours = EXCLUDED.reading_period_hours,
    status = EXCLUDED.status,
    scheduled_at = EXCLUDED.scheduled_at,
    published_at = EXCLUDED.published_at,
    tenant_id = EXCLUDED.tenant_id;

INSERT INTO episode_creators (
    tenant_id,
    episode_id,
    creator_id,
    role_id,
    display_order,
    source,
    share_bps
)
SELECT
    e.tenant_id,
    e.id,
    c.id,
    r.id,
    credit.display_order,
    'episode',
    credit.share_bps
FROM episodes e
CROSS JOIN (
    VALUES ('RoyaAUTHAAA1', 'Artist', 1, 3000),
        ('RoyaAUTHAAA2', 'Original Author', 2, 2000)
) AS credit(creator_public_id, role_name, display_order, share_bps)
JOIN creators c ON c.public_id = credit.creator_public_id
JOIN creator_roles r ON r.tenant_id = e.tenant_id AND r.name = credit.role_name
WHERE e.public_id = 'RoyaEPSDAAA1'
ON CONFLICT (episode_id, creator_id, role_id) DO UPDATE
SET display_order = EXCLUDED.display_order,
    source = EXCLUDED.source,
    share_bps = EXCLUDED.share_bps;

-- January 2026 in the tenant's zone (UTC): ten sales of the 500-yen episode,
-- and an eleventh refunded in full, which is not a sale and, as every full
-- refund does, revokes the purchase. The buyer is left unset the way a deleted
-- reader leaves it; a statement never names one.
INSERT INTO purchases (id, user_id, episode_id, price_at_purchase, currency, purchased_at, tenant_id, refunded_at, refunded_amount, revoked_at, revocation_reason)
SELECT
    ('018f0f80-0008-7000-8000-' || lpad(n::text, 12, '0'))::uuid,
    NULL,
    e.id,
    500,
    'JPY',
    '2026-01-10T12:00:00Z'::timestamptz + n * INTERVAL '1 hour',
    e.tenant_id,
    CASE WHEN n = 11 THEN '2026-01-20T00:00:00Z'::timestamptz END,
    CASE WHEN n = 11 THEN 500 END,
    CASE WHEN n = 11 THEN '2026-01-20T00:00:00Z'::timestamptz END,
    CASE WHEN n = 11 THEN 'refund' END
FROM episodes e
CROSS JOIN generate_series(1, 11) AS n
WHERE e.public_id = 'RoyaEPSDAAA1';

-- A reader who subscribes to a plan of the whole catalog, paid 980 yen on
-- 1 January 2026 for a period that ends in January, and finished the episode
-- in that period. The month shares the payment to the episode alone, so its
-- authors are credited 294 and 196 yen on a subscription line each.
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
    '018f0f80-000b-7000-8000-000000000001'::uuid,
    t.id,
    'RoyaMMBRAAA1',
    'royalty-reader@example.com',
    '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
    'Royalty Subscriber',
    'active',
    NOW()
FROM tenants t
WHERE t.public_id = 'RoyaTNNTAAA1';

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
    '018f0f80-000c-7000-8000-000000000001'::uuid,
    t.id,
    'RoyaPLANAAA1',
    'Royalty pass',
    'Every episode, every month.',
    'price_royalties_e2e',
    980,
    'JPY',
    'month',
    1,
    'all',
    true
FROM tenants t
WHERE t.public_id = 'RoyaTNNTAAA1';

INSERT INTO subscriptions (
    id,
    tenant_id,
    user_id,
    plan_id,
    stripe_customer_id,
    stripe_subscription_id,
    stripe_price_id,
    status,
    current_period_end
)
SELECT
    '018f0f80-000d-7000-8000-000000000001'::uuid,
    p.tenant_id,
    '018f0f80-000b-7000-8000-000000000001'::uuid,
    p.id,
    'cus_royalties_e2e',
    'sub_royalties_e2e',
    p.stripe_price_id,
    'active',
    '2026-01-31T00:00:00Z'::timestamptz
FROM subscription_plans p
WHERE p.public_id = 'RoyaPLANAAA1';

INSERT INTO subscription_payments (
    id,
    tenant_id,
    subscription_id,
    plan_id,
    stripe_invoice_id,
    stripe_payment_intent_id,
    amount,
    currency,
    period_start,
    period_end,
    paid_at
)
SELECT
    '018f0f80-000e-7000-8000-000000000001'::uuid,
    s.tenant_id,
    s.id,
    s.plan_id,
    'in_royalties_e2e',
    'pi_royalties_e2e',
    980,
    'JPY',
    '2026-01-01T00:00:00Z'::timestamptz,
    '2026-01-31T00:00:00Z'::timestamptz,
    '2026-01-01T00:00:00Z'::timestamptz
FROM subscriptions s
WHERE s.id = '018f0f80-000d-7000-8000-000000000001'::uuid;

-- The finish is months old, and the worker purges the content events past a
-- tenant's retention period, the platform's 90 days unless the tenant keeps
-- them longer. Without this the month would have nothing to share the payment
-- by once a purge had run.
INSERT INTO tenant_retention_settings (tenant_id, content_event_days)
SELECT t.id, 3650
FROM tenants t
WHERE t.public_id = 'RoyaTNNTAAA1';

INSERT INTO content_events (
    id,
    tenant_id,
    event_type,
    user_id,
    series_id,
    episode_id,
    source_table,
    source_id,
    occurred_at
)
SELECT
    '018f0f80-000f-7000-8000-000000000001'::uuid,
    e.tenant_id,
    'episode_complete',
    '018f0f80-000b-7000-8000-000000000001'::uuid,
    e.series_id,
    e.id,
    'episode_reads',
    '018f0f80-0010-7000-8000-000000000001'::uuid,
    '2026-01-15T12:00:00Z'::timestamptz
FROM episodes e
WHERE e.public_id = 'RoyaEPSDAAA1';
