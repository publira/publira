-- Scenario: the tenant targeted and scheduled announcements are posted into
--
-- A targeted announcement reaches only the readers its conditions select, so
-- the spec that posts one needs readers apart on a condition and a tenant no
-- other spec counts the notifications of: a delivery here raises the bell of
-- the readers it selects, and a scheduled announcement left on the list would
-- sit among another spec's rows.
--
-- One series, followed by one of the two readers and not the other, is what a
-- Follows series condition tells them apart by. The series has no episode, so
-- nothing but an announcement can notify anyone in this tenant.
-- Password hashes match the dev seed (`adminpass` / `memberpass`). public_id
-- values are hard-coded in e2e/src/scenarios/announcement-audience.ts.
--   tenant   AudcTNNTAAA1 (audience.localhost / admin.audience.localhost)
--   editor   AudcEDTRAAA1 — a tenant_editor, who posts the announcements
--   follower AudcFLWRAAA1 — a reader who follows the series
--   reader   AudcRDERAAA1 — a reader who does not
--   series   AudcSERSAAA1
--
-- ID band: 018f1aa0-0001-7000-8000-0000000000NN.

WITH tenant_seed AS (
    SELECT '018f1aa0-0001-7000-8000-000000000001'::uuid AS id
)
INSERT INTO tenants (id, public_id, domain, admin_domain, name, status, timezone, default_locale, supported_locales)
SELECT
    ts.id,
    'AudcTNNTAAA1',
    'audience.localhost:' || :'tenant_port',
    'admin.audience.localhost:' || :'tenant_port',
    'Audience Tenant',
    'active',
    'UTC',
    'en',
    ARRAY['en', 'ja']
FROM tenant_seed ts
ON CONFLICT (public_id) DO UPDATE
SET domain = EXCLUDED.domain,
    admin_domain = EXCLUDED.admin_domain,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    timezone = EXCLUDED.timezone,
    default_locale = EXCLUDED.default_locale,
    supported_locales = EXCLUDED.supported_locales;

\set seed_tenant AudcTNNTAAA1
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
    seed.password_hash,
    seed.name,
    'active',
    NOW()
FROM (
    VALUES
        (
            '018f1aa0-0001-7000-8000-000000000011'::uuid,
            'AudcEDTRAAA1',
            'audience-editor@example.com',
            '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
            'Audience E2E Editor'
        ),
        (
            '018f1aa0-0001-7000-8000-000000000012'::uuid,
            'AudcFLWRAAA1',
            'audience-follower@example.com',
            '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
            'Audience E2E Follower'
        ),
        (
            '018f1aa0-0001-7000-8000-000000000013'::uuid,
            'AudcRDERAAA1',
            'audience-reader@example.com',
            '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
            'Audience E2E Reader'
        )
) AS seed (id, public_id, email, password_hash, name)
JOIN tenants t ON t.public_id = 'AudcTNNTAAA1'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status;

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
SELECT
    '018f1aa0-0001-7000-8000-000000000021'::uuid,
    u.id,
    'tenant_editor',
    u.tenant_id
FROM users u
WHERE u.public_id = 'AudcEDTRAAA1'
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO labels (id, tenant_id, public_id, name)
SELECT
    '018f1aa0-0001-7000-8000-000000000031'::uuid,
    t.id,
    'AudcLABLAAA1',
    'Audience Label'
FROM tenants t
WHERE t.public_id = 'AudcTNNTAAA1'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    name = EXCLUDED.name;

INSERT INTO series (id, tenant_id, label_id, public_id, is_published, published_at)
SELECT
    '018f1aa0-0001-7000-8000-000000000041'::uuid,
    t.id,
    '018f1aa0-0001-7000-8000-000000000031'::uuid,
    'AudcSERSAAA1',
    true,
    NOW() - INTERVAL '1 day'
FROM tenants t
WHERE t.public_id = 'AudcTNNTAAA1'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    label_id = EXCLUDED.label_id,
    is_published = EXCLUDED.is_published,
    published_at = EXCLUDED.published_at,
    updated_at = NOW();

INSERT INTO series_translations (id, series_id, tenant_id, locale, title, synopsis)
SELECT
    '018f1aa0-0001-7000-8000-000000000051'::uuid,
    s.id,
    s.tenant_id,
    'en',
    'Audience Series',
    'The series the follower follows.'
FROM series s
WHERE s.id = '018f1aa0-0001-7000-8000-000000000041'::uuid
ON CONFLICT (series_id, locale) DO UPDATE
SET title = EXCLUDED.title,
    synopsis = EXCLUDED.synopsis;

INSERT INTO series_listings (series_id, reading_period_hours, tenant_id)
SELECT
    s.id,
    72,
    s.tenant_id
FROM series s
WHERE s.id = '018f1aa0-0001-7000-8000-000000000041'::uuid
ON CONFLICT (series_id) DO UPDATE
SET reading_period_hours = EXCLUDED.reading_period_hours,
    tenant_id = EXCLUDED.tenant_id;

INSERT INTO series_follows (tenant_id, user_id, series_id)
SELECT
    u.tenant_id,
    u.id,
    '018f1aa0-0001-7000-8000-000000000041'::uuid
FROM users u
WHERE u.public_id = 'AudcFLWRAAA1'
ON CONFLICT (tenant_id, user_id, series_id) DO NOTHING;

-- Everything this tenant holds was posted by a previous run of the spec, so a
-- re-run starts from an empty list and an empty bell.
DELETE FROM notifications n
USING tenants t
WHERE n.tenant_id = t.id
    AND t.public_id = 'AudcTNNTAAA1';

DELETE FROM announcements a
USING tenants t
WHERE a.tenant_id = t.id
    AND t.public_id = 'AudcTNNTAAA1';
