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
--   CtctMSGAAAA3 a guest's message staff have dealt with, with the answer the
--                seed admin sent and the reply the guest mailed back from
--                another address
--
-- Deleting the messages takes their entries with them (ON DELETE CASCADE), so
-- an answer the suite sends is cleared the same way.

DELETE FROM contact_messages
WHERE public_id IN ('CtctMSGAAAA1', 'CtctMSGAAAA2', 'CtctMSGAAAA3')
    AND tenant_id = (SELECT id FROM tenants WHERE public_id = 'SeedTNNTAAA1');

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
JOIN tenants t ON t.public_id = 'SeedTNNTAAA1'
LEFT JOIN users u ON u.tenant_id = t.id AND u.email = cms.sender_email;

INSERT INTO contact_message_entries (
    id,
    tenant_id,
    contact_message_id,
    direction,
    author_id,
    body,
    message_id,
    from_email,
    created_at
)
SELECT
    cme.id,
    t.id,
    '018f0f30-0006-7000-8000-000000000003'::uuid,
    cme.direction,
    u.id,
    cme.body,
    cme.message_id,
    cme.from_email,
    cme.created_at
FROM (
    VALUES
        (
            '018f0f30-0007-7000-8000-000000000001'::uuid,
            'staff',
            'admin@example.com',
            'Thank you for reading it. The next chapter is out on Friday.',
            'contact-inbox-answer-1@seed.example.com',
            NULL,
            '2026-06-01T04:00:00Z'::timestamptz
        ),
        (
            '018f0f30-0007-7000-8000-000000000002'::uuid,
            'reader',
            NULL,
            'I will be waiting for it.',
            'contact-inbox-reply-1@reader.example.com',
            'contact-inbox-answered.home@example.com',
            '2026-06-01T04:30:00Z'::timestamptz
        )
) AS cme (id, direction, author_email, body, message_id, from_email, created_at)
JOIN tenants t ON t.public_id = 'SeedTNNTAAA1'
LEFT JOIN users u ON u.tenant_id = t.id AND u.email = cme.author_email;
