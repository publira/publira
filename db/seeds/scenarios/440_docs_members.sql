-- Scenario: the invitations the documentation's screenshots show
--
-- The page under docs/<locale>/4-console/ about members explains the
-- Invitations list, which the development seed tenant, SeedTNNTAAA1, has
-- nothing in. Two invitations are written into it, with the dates as
-- literals for the reason 160_screenshot_baseline.sql gives: one that expired
-- unanswered and one a tenant admin canceled. Whether an invitation is still
-- pending is decided against the current time, so a pending one would have
-- to carry a date that moves with the day the stack was seeded.
--
-- Applied by e2e/tests/admin.docs-screenshots.setup.ts. Nothing else reads the
-- seed tenant's invitations, and the file deletes its own rows before writing
-- them, so it can be applied any number of times.

BEGIN;

DELETE FROM tenant_admin_invitations
WHERE id IN (
    '018f1090-0004-7000-8000-000000000001'::uuid,
    '018f1090-0004-7000-8000-000000000002'::uuid
);

INSERT INTO tenant_admin_invitations (
    id,
    tenant_id,
    email,
    token_hash,
    role,
    expires_at,
    canceled_at,
    created_at,
    updated_at
)
SELECT
    i.id,
    t.id,
    i.email,
    i.token_hash,
    i.role,
    i.created_at + INTERVAL '24 hours',
    i.canceled_at,
    i.created_at,
    COALESCE(i.canceled_at, i.created_at)
FROM (
    VALUES
        (
            '018f1090-0004-7000-8000-000000000001'::uuid,
            'new-editor@example.com',
            'docs-screenshots-invitation-1',
            'tenant_editor',
            '2026-02-02T10:00:00Z'::timestamptz,
            NULL::timestamptz
        ),
        (
            '018f1090-0004-7000-8000-000000000002'::uuid,
            'former-admin@example.com',
            'docs-screenshots-invitation-2',
            'tenant_admin',
            '2026-01-26T10:00:00Z'::timestamptz,
            '2026-01-26T15:30:00Z'::timestamptz
        )
) AS i (id, email, token_hash, role, created_at, canceled_at)
JOIN tenants t ON t.public_id = 'SeedTNNTAAA1';

COMMIT;
