-- Scenario: a tenant whose staff share the contact inbox
--
-- `admin.contact-workflow.spec.ts` assigns, reassigns, and clears contact
-- messages between two tenant admins, marks them handled and reopens them,
-- and keeps a staff note on them. The assignee picker offers every tenant
-- admin of the tenant, so the development seed tenant, whose only admin other
-- suites sign in as and whose inbox `admin.contact-inbox.spec.ts` walks, cannot
-- absorb it.
--
-- Applying it is also how the suite starts over: the tenant is deleted and
-- written again, which takes the messages, their assignees and notes, the
-- message the suite sends through the public API, and the audit entries with
-- it. The tenant owns no series.
--
-- Password hashes match the dev seed (`adminpass`). public_id values are
-- hard-coded in e2e/src/scenarios/contact-workflow.ts.
--   tenant  DeskTNNTAAA1 (desk.localhost / admin.desk.localhost)
--   admin   DeskADMNAAA1 — signs in first and assigns messages to the colleague
--   admin   DeskADMNAAA2 — the colleague the messages are handed to
--   editor  DeskEDTRAAA1 — staff who cannot open the inbox, never offered
--   message DeskMSGAAAA1 — unhandled and unassigned; the suite walks this one
--   message DeskMSGAAAA2 — in progress with the colleague, with a staff note
--   message DeskMSGAAAA3 — handled by the colleague, still assigned to the admin
--
-- ID band: 018f1070-0001-7000-8000-0000000000NN.

DELETE FROM tenants
WHERE public_id = 'DeskTNNTAAA1';

WITH tenant_seed AS (
    SELECT '018f1070-0001-7000-8000-000000000001'::uuid AS id
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
    'DeskTNNTAAA1',
    'desk.localhost:' || :'tenant_port',
    'admin.desk.localhost:' || :'tenant_port',
    'Desk Tenant',
    'active',
    'en'
FROM tenant_seed ts;

\set seed_tenant DeskTNNTAAA1
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
            '018f1070-0001-7000-8000-000000000011'::uuid,
            'DeskADMNAAA1',
            'desk-admin@example.com',
            'Desk E2E Admin'
        ),
        (
            '018f1070-0001-7000-8000-000000000012'::uuid,
            'DeskADMNAAA2',
            'desk-colleague@example.com',
            'Desk E2E Colleague'
        ),
        (
            '018f1070-0001-7000-8000-000000000013'::uuid,
            'DeskEDTRAAA1',
            'desk-editor@example.com',
            'Desk E2E Editor'
        )
) AS seed (id, public_id, email, name)
JOIN tenants t ON t.public_id = 'DeskTNNTAAA1';

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
SELECT seed.id, u.id, seed.role, u.tenant_id
FROM (
    VALUES
        (
            '018f1070-0001-7000-8000-000000000021'::uuid,
            'DeskADMNAAA1',
            'tenant_admin'
        ),
        (
            '018f1070-0001-7000-8000-000000000022'::uuid,
            'DeskADMNAAA2',
            'tenant_admin'
        ),
        (
            '018f1070-0001-7000-8000-000000000023'::uuid,
            'DeskEDTRAAA1',
            'tenant_editor'
        )
) AS seed (id, public_id, role)
JOIN users u ON u.public_id = seed.public_id;

-- The handled message was completed by the colleague but is still assigned to
-- the admin, so the inbox naming the admin proves it shows the assignee rather
-- than whoever marked the message handled. The in-progress message carries a
-- staff note before the suite starts, so the one submission it sends through
-- the public API comes from a reader staff already hold a note about.
WITH contact_message_seed (
    id,
    public_id,
    reply_to_email,
    subject,
    body,
    created_at,
    handled_at,
    handled_by_public_id,
    assigned_to_public_id,
    staff_note
) AS (
    VALUES
        (
            '018f1070-0001-7000-8000-000000000031'::uuid,
            'DeskMSGAAAA1',
            'desk-reader-one@example.com',
            'The second episode will not open',
            'The second episode stops loading halfway through.',
            '2026-06-03T02:00:00Z'::timestamptz,
            NULL::timestamptz,
            NULL,
            NULL,
            NULL
        ),
        (
            '018f1070-0001-7000-8000-000000000032'::uuid,
            'DeskMSGAAAA2',
            'desk-reader-two@example.com',
            'A typo on the third page',
            'The third page spells the hero''s name two different ways.',
            '2026-06-02T02:00:00Z'::timestamptz,
            NULL::timestamptz,
            NULL,
            'DeskADMNAAA2',
            'Internal: the misspelling is fixed in the next printing.'
        ),
        (
            '018f1070-0001-7000-8000-000000000033'::uuid,
            'DeskMSGAAAA3',
            'desk-reader-three@example.com',
            'Thank you for the new series',
            'I read it in one sitting. Please keep it coming.',
            '2026-06-01T02:00:00Z'::timestamptz,
            '2026-06-01T05:00:00Z'::timestamptz,
            'DeskADMNAAA2',
            'DeskADMNAAA1',
            NULL
        )
)
INSERT INTO contact_messages (
    id,
    tenant_id,
    public_id,
    reply_to_email,
    subject,
    body,
    created_at,
    handled_at,
    handled_by,
    assigned_to,
    staff_note
)
SELECT
    cms.id,
    t.id,
    cms.public_id,
    cms.reply_to_email,
    cms.subject,
    cms.body,
    cms.created_at,
    cms.handled_at,
    handler.id,
    assignee.id,
    cms.staff_note
FROM contact_message_seed cms
JOIN tenants t ON t.public_id = 'DeskTNNTAAA1'
LEFT JOIN users handler ON handler.public_id = cms.handled_by_public_id
LEFT JOIN users assignee ON assignee.public_id = cms.assigned_to_public_id;
