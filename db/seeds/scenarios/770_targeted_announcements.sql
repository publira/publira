-- Scenario: the tenant whose storefront lists a targeted announcement
--
-- A targeted announcement is listed and opened only by the readers it was
-- delivered to, so the spec that reads one needs a reader it reached and a
-- reader it did not, and a tenant no other spec counts the list or the bell
-- of: holding the announcement's notification is what lets a reader see it.
--
-- The announcement is written as the worker leaves one it has delivered: its
-- audience names the readers who signed up in the last 30 days, which the
-- reader did and the other reader, who signed up a year ago, did not, and the
-- reader holds its notification row and nobody else does. Two announcements
-- for everyone are delivered a day before and a day after it, so it is listed
-- between them.
--
-- It owns no series, so nothing but these announcements can notify anyone in
-- it. Password hashes match the dev seed (`memberpass`). public_id values and
-- the announcement ids are hard-coded in
-- e2e/src/scenarios/targeted-announcements.ts.
--   tenant TrgtTNNTAAA1 (targeted.localhost / admin.targeted.localhost)
--   reader TrgtRDERAAA1 — the reader the targeted announcement was sent to
--   other  TrgtOTHRAAA1 — a reader it was not sent to
--
-- Re-applying it puts every announcement back to unread.
--
-- ID band: 018f1ab0-0001-7000-8000-0000000000NN.

WITH tenant_seed AS (
    SELECT '018f1ab0-0001-7000-8000-000000000001'::uuid AS id
)
INSERT INTO tenants (id, public_id, domain, admin_domain, name, status, default_locale, supported_locales)
SELECT
    ts.id,
    'TrgtTNNTAAA1',
    'targeted.localhost:' || :'tenant_port',
    'admin.targeted.localhost:' || :'tenant_port',
    'Targeted Tenant',
    'active',
    'en',
    ARRAY['en', 'ja']
FROM tenant_seed ts
ON CONFLICT (public_id) DO UPDATE
SET domain = EXCLUDED.domain,
    admin_domain = EXCLUDED.admin_domain,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    default_locale = EXCLUDED.default_locale,
    supported_locales = EXCLUDED.supported_locales;

\set seed_tenant TrgtTNNTAAA1
\ir ../creator_roles.sql

INSERT INTO users (
    id,
    tenant_id,
    public_id,
    email,
    password_hash,
    name,
    status,
    email_verified_at,
    created_at
)
SELECT
    seed.id,
    t.id,
    seed.public_id,
    seed.email,
    seed.password_hash,
    seed.name,
    'active',
    NOW(),
    NOW() - seed.age
FROM (
    VALUES
        (
            '018f1ab0-0001-7000-8000-000000000011'::uuid,
            'TrgtRDERAAA1',
            'targeted-reader@example.com',
            '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
            'Targeted E2E Reader',
            INTERVAL '1 day'
        ),
        (
            '018f1ab0-0001-7000-8000-000000000012'::uuid,
            'TrgtOTHRAAA1',
            'targeted-other@example.com',
            '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
            'Targeted E2E Other',
            INTERVAL '365 days'
        )
) AS seed (id, public_id, email, password_hash, name, age)
JOIN tenants t ON t.public_id = 'TrgtTNNTAAA1'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    created_at = EXCLUDED.created_at;

-- Deleting the announcements takes their read marks with them.
DELETE FROM notifications n
USING tenants t
WHERE n.tenant_id = t.id
    AND t.public_id = 'TrgtTNNTAAA1';

DELETE FROM announcements a
USING tenants t
WHERE a.tenant_id = t.id
    AND t.public_id = 'TrgtTNNTAAA1';

WITH a (id, title, body, delivered_at, audience) AS (
    VALUES
        (
            '018f1ab0-0001-7000-8000-000000000021'::uuid,
            'Targeted E2E Older Notice',
            'An announcement for everyone, delivered first.',
            NOW() - INTERVAL '3 days',
            NULL::jsonb
        ),
        (
            '018f1ab0-0001-7000-8000-000000000022'::uuid,
            'Targeted E2E Notice for New Readers',
            'An announcement for the readers who signed up in the last 30 days.',
            NOW() - INTERVAL '2 days',
            jsonb_build_object(
                'version', 1,
                'conditions', jsonb_build_array(
                    jsonb_build_object('type', 'signed_up_within_days', 'days', 30)
                )
            )
        ),
        (
            '018f1ab0-0001-7000-8000-000000000023'::uuid,
            'Targeted E2E Newer Notice',
            'An announcement for everyone, delivered last.',
            NOW() - INTERVAL '1 day',
            NULL::jsonb
        )
),
inserted AS (
    INSERT INTO announcements (
        id,
        tenant_id,
        announcement_type,
        audience,
        created_at,
        delivered_at
    )
    SELECT
        a.id,
        t.id,
        'announcement',
        a.audience,
        a.delivered_at,
        a.delivered_at
    FROM a
    JOIN tenants t ON t.public_id = 'TrgtTNNTAAA1'
    RETURNING id, tenant_id
)
INSERT INTO announcement_translations (id, announcement_id, tenant_id, locale, title, body, created_at, updated_at)
SELECT uuidv7(), a.id, i.tenant_id, 'en', a.title, a.body, a.delivered_at, a.delivered_at
FROM a
JOIN inserted i ON i.id = a.id;

INSERT INTO notifications (
    id,
    tenant_id,
    user_id,
    notification_type,
    subject_key,
    payload,
    category,
    created_at
)
SELECT
    '018f1ab0-0001-7000-8000-000000000031'::uuid,
    u.tenant_id,
    u.id,
    'announcement_posted',
    'announcement:018f1ab0-0001-7000-8000-000000000022',
    jsonb_build_object('announcement_title', 'Targeted E2E Notice for New Readers'),
    'announcements',
    NOW() - INTERVAL '2 days'
FROM users u
WHERE u.public_id = 'TrgtRDERAAA1';
