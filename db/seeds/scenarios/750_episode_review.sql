-- Scenario: a tenant that turns on review before publishing, and the staff
-- who take an episode through a round of it
--
-- `admin.episode-review.spec.ts` has the tenant admin turn review on under
-- Settings, the editor schedule a draft, which submits it, the admin return
-- it with a comment, the editor read the comment and submit it again, and the
-- admin approve it, while the auditor reads every round and is offered no
-- control. Review is one setting for a whole tenant, and it holds back every
-- scheduled episode, so no tenant another suite schedules on can absorb it.
--
-- Applying it is also how the suite starts over: the tenant is deleted and
-- written again with review off, which takes the rounds of review with it.
-- The catalog restricts the deletes that would reach it from the tenant, so
-- it goes first.
-- public_id values are hard-coded in e2e/src/scenarios/episode-review.ts.
--   tenant   RvewTNNTAAA1 (review.localhost / admin.review.localhost,
--            Review Tenant), on UTC, with review off
--   admin    RvewADMNAAA1 (review-admin@example.com)
--   editor   RvewEDTRAAA1 (review-editor@example.com)
--   auditor  RvewAUDTAAA1 (review-auditor@example.com)
--   label    RvewLABLAAA1
--   series   RvewSERSAAA1 (Review Series 001), published
--   episode  RvewEPSDAAA1 (Review Episode 001-01), a draft

DELETE FROM content_events
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'RvewTNNTAAA1');

DELETE FROM episodes
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'RvewTNNTAAA1');

DELETE FROM series
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'RvewTNNTAAA1');

-- A tenant's audit entries hold its deletion back, so they go first.
DELETE FROM audit_logs
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'RvewTNNTAAA1');

DELETE FROM tenants
WHERE public_id = 'RvewTNNTAAA1';

INSERT INTO tenants (
    id,
    public_id,
    domain,
    admin_domain,
    name,
    status,
    timezone,
    default_locale,
    supported_locales
)
VALUES (
    '018f1750-0001-7000-8000-000000000001'::uuid,
    'RvewTNNTAAA1',
    'review.localhost:' || :'tenant_port',
    'admin.review.localhost:' || :'tenant_port',
    'Review Tenant',
    'active',
    'UTC',
    'en',
    ARRAY['en', 'ja']
);

\set seed_tenant RvewTNNTAAA1
\ir ../creator_roles.sql

-- The password hash is the same as `adminpass` for every account.
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
            '018f1750-0002-7000-8000-000000000001'::uuid,
            'RvewADMNAAA1',
            'review-admin@example.com',
            '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
            'Review Admin'
        ),
        (
            '018f1750-0002-7000-8000-000000000002'::uuid,
            'RvewEDTRAAA1',
            'review-editor@example.com',
            '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
            'Review Editor'
        ),
        (
            '018f1750-0002-7000-8000-000000000003'::uuid,
            'RvewAUDTAAA1',
            'review-auditor@example.com',
            '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
            'Review Auditor'
        )
) AS u(id, public_id, email, password_hash, name)
CROSS JOIN tenants t
WHERE t.public_id = 'RvewTNNTAAA1';

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
SELECT
    r.id,
    u.id,
    r.role,
    u.tenant_id
FROM (
    VALUES
        ('018f1750-0003-7000-8000-000000000001'::uuid, 'RvewADMNAAA1', 'tenant_admin'),
        ('018f1750-0003-7000-8000-000000000002'::uuid, 'RvewEDTRAAA1', 'tenant_editor'),
        ('018f1750-0003-7000-8000-000000000003'::uuid, 'RvewAUDTAAA1', 'tenant_auditor')
) AS r(id, public_id, role)
JOIN users u ON u.public_id = r.public_id;

INSERT INTO labels (id, tenant_id, public_id, name)
SELECT
    '018f1750-0004-7000-8000-000000000001'::uuid,
    t.id,
    'RvewLABLAAA1',
    'Review Label'
FROM tenants t
WHERE t.public_id = 'RvewTNNTAAA1';

INSERT INTO series (id, tenant_id, label_id, public_id, is_published, published_at)
SELECT
    '018f1750-0005-7000-8000-000000000001'::uuid,
    t.id,
    '018f1750-0004-7000-8000-000000000001'::uuid,
    'RvewSERSAAA1',
    true,
    '2026-01-01T00:00:00Z'::timestamptz
FROM tenants t
WHERE t.public_id = 'RvewTNNTAAA1';

INSERT INTO series_translations (id, series_id, tenant_id, locale, title, synopsis)
SELECT
    '018f1750-0006-7000-8000-000000000001'::uuid,
    s.id,
    s.tenant_id,
    t.default_locale,
    'Review Series 001',
    'A series whose episodes wait for a tenant admin before they go out.'
FROM series s
JOIN tenants t ON t.id = s.tenant_id
WHERE s.public_id = 'RvewSERSAAA1';

INSERT INTO series_listings (series_id, tenant_id)
SELECT s.id, s.tenant_id
FROM series s
WHERE s.public_id = 'RvewSERSAAA1';

INSERT INTO episodes (id, series_id, public_id, order_index, tenant_id)
SELECT
    '018f1750-0007-7000-8000-000000000001'::uuid,
    s.id,
    'RvewEPSDAAA1',
    1,
    s.tenant_id
FROM series s
WHERE s.public_id = 'RvewSERSAAA1';

INSERT INTO episode_translations (id, episode_id, tenant_id, locale, title)
SELECT
    '018f1750-0008-7000-8000-000000000001'::uuid,
    e.id,
    e.tenant_id,
    t.default_locale,
    'Review Episode 001-01'
FROM episodes e
JOIN tenants t ON t.id = e.tenant_id
WHERE e.public_id = 'RvewEPSDAAA1';

INSERT INTO episode_listings (episode_id, price, status, tenant_id)
SELECT e.id, 0, 'draft', e.tenant_id
FROM episodes e
WHERE e.public_id = 'RvewEPSDAAA1';
