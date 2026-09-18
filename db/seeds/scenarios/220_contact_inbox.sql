-- Scenario: contact messages the admin console's inbox E2E reads
--
-- `admin.contact-inbox.spec.ts` reads these from the development seed tenant's
-- inbox and marks one of them handled. Seeding them rather than sending them
-- through the public site's contact form is what fixes the states and senders
-- the inbox has to tell apart.
--
-- Applying it is also how the suite puts the three messages back: each row is
-- removed and re-inserted, which is what resets the one the spec marked.
-- public_id values are hard-coded in e2e/src/scenarios/contact-inbox.ts.
--   CtctMSGAAAA1 a signed-in reader's message, still waiting
--   CtctMSGAAAA2 a guest's message with no subject, still waiting
--   CtctMSGAAAA3 a guest's message staff have dealt with

DELETE FROM contact_messages
WHERE public_id IN ('CtctMSGAAAA1', 'CtctMSGAAAA2', 'CtctMSGAAAA3')
    AND tenant_id = (SELECT id FROM tenants WHERE domain = 'localhost');

WITH contact_message_seed (
    id,
    public_id,
    sender_email,
    reply_to_email,
    subject,
    body,
    created_at,
    handled_at
) AS (
    VALUES
        (
            '018f0f30-0006-7000-8000-000000000001'::uuid,
            'CtctMSGAAAA1',
            'member@example.com',
            'contact-inbox-reader@example.com',
            'Cannot open an episode',
            E'The second episode of Seed Series 001 will not open for me.\nThe first one is fine.',
            '2026-06-03T02:00:00Z'::timestamptz,
            NULL::timestamptz
        ),
        (
            '018f0f30-0006-7000-8000-000000000002'::uuid,
            'CtctMSGAAAA2',
            NULL,
            'contact-inbox-guest@example.com',
            NULL,
            'Do you have an app for phones?',
            '2026-06-02T02:00:00Z'::timestamptz,
            NULL::timestamptz
        ),
        (
            '018f0f30-0006-7000-8000-000000000003'::uuid,
            'CtctMSGAAAA3',
            NULL,
            'contact-inbox-answered@example.com',
            'Thank you for the new series',
            'I read it in one sitting. Please keep it coming.',
            '2026-06-01T02:00:00Z'::timestamptz,
            '2026-06-01T05:00:00Z'::timestamptz
        )
)
INSERT INTO contact_messages (
    id,
    tenant_id,
    public_id,
    user_id,
    reply_to_email,
    subject,
    body,
    created_at,
    handled_at
)
SELECT
    cms.id,
    t.id,
    cms.public_id,
    u.id,
    cms.reply_to_email,
    cms.subject,
    cms.body,
    cms.created_at,
    cms.handled_at
FROM contact_message_seed cms
JOIN tenants t ON t.domain = 'localhost'
LEFT JOIN users u ON u.tenant_id = t.id AND u.email = cms.sender_email;
