-- Scenario: a reader who sends the tenant a message from the contact form
--
-- `host.contact-form.spec.ts` follows the date of birth copy on the settings
-- screen to the contact form, which only a reader with a stored birth date is
-- shown, and sends a message as that reader and as a guest. The dev seed
-- member has no birth date, and giving it one would change what the settings
-- and age rating suites see, so the reader is an account of its own.
--
-- Applying this file is also how the suite removes the messages it sent: every
-- one of them answers at an address below, so the spec asserts a row the run
-- itself wrote. Password hash matches the dev seed (`memberpass`).
-- public_id values are hard-coded in e2e/src/scenarios/contact-form.ts.
--   member CfrmMMBRAAA1 (contact-form-member@example.com)

WITH member_user_seed AS (
    SELECT '018f0f30-0007-7000-8000-000000000001'::uuid AS id
)
INSERT INTO users (
    id,
    tenant_id,
    public_id,
    email,
    password_hash,
    name,
    status,
    email_verified_at,
    birth_date
)
SELECT
    mus.id,
    t.id,
    'CfrmMMBRAAA1',
    'contact-form-member@example.com',
    '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
    'Contact Form Member',
    'active',
    NOW(),
    '1990-04-02'::date
FROM member_user_seed mus
JOIN tenants t ON t.domain = 'localhost'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    email_verified_at = EXCLUDED.email_verified_at,
    birth_date = EXCLUDED.birth_date;

DELETE FROM contact_messages
WHERE reply_to_email IN (
        'contact-form-member@example.com',
        'contact-form-guest@example.com'
    )
    AND tenant_id = (SELECT id FROM tenants WHERE domain = 'localhost');
