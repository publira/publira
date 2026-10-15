-- Scenario: readers the admin console's moderation E2E may suspend, delete,
-- or take an icon from
--
-- `admin.readers.spec.ts` suspends one reader, lifts the suspension, deletes
-- another, and removes a third one's icon from the reader detail page. The dev
-- seed member cannot absorb any of that: other suites sign in with its
-- address, and a deleted account is gone for every suite that runs after.
--
-- Applying this file is also how the suite puts all three readers back, so
-- each statement writes the starting value, including re-creating the deleted
-- account and electing the icon again. Password hash matches the dev seed
-- (`memberpass`).
-- public_id values are hard-coded in e2e/src/scenarios/reader-moderation.ts.
--   member RmodMMBRAAA1 (reader-moderation-suspend@example.com)
--   member RmodMMBRAAA2 (reader-moderation-delete@example.com)
--   member RmodMMBRAAA3 (reader-moderation-icon@example.com)

WITH member_user_seed (id, public_id, email, name) AS (
    VALUES
        (
            '018f0f30-0004-7000-8000-000000000001'::uuid,
            'RmodMMBRAAA1',
            'reader-moderation-suspend@example.com',
            'Reader Moderation E2E Suspend'
        ),
        (
            '018f0f30-0004-7000-8000-000000000002'::uuid,
            'RmodMMBRAAA2',
            'reader-moderation-delete@example.com',
            'Reader Moderation E2E Delete'
        ),
        (
            '018f0f30-0004-7000-8000-000000000003'::uuid,
            'RmodMMBRAAA3',
            'reader-moderation-icon@example.com',
            'Reader Moderation E2E Icon'
        )
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
    mus.id,
    t.id,
    mus.public_id,
    mus.email,
    '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
    mus.name,
    'active',
    NOW()
FROM member_user_seed mus
JOIN tenants t ON t.public_id = 'SeedTNNTAAA1'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    email_verified_at = EXCLUDED.email_verified_at;

-- The icon the suite removes. It names an object `task storage:seed` already
-- uploaded for a seed author rather than one of its own, which is how the
-- seed catalogue shares its artwork: the orphan sweep keeps an object while
-- any variant of any kind names it, so the removal leaves the author's icon in
-- place. The sweep may have deleted the image row since the last run, so both
-- rows are written again rather than assumed.
WITH icon_seed AS (
    SELECT
        u.id AS user_id,
        u.tenant_id,
        '018f0f31-0004-7000-8000-000000000003'::uuid AS image_id
    FROM users u
    WHERE u.public_id = 'RmodMMBRAAA3'
)
INSERT INTO user_images (id, tenant_id, user_id)
SELECT image_id, tenant_id, user_id
FROM icon_seed
ON CONFLICT (id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    user_id = EXCLUDED.user_id;

INSERT INTO user_image_variants (
    id,
    tenant_id,
    user_image_id,
    label,
    storage_provider,
    object_key,
    content_type,
    file_size_bytes,
    width,
    height
)
SELECT
    '018f0f32-0004-7000-8000-000000000003'::uuid,
    ui.tenant_id,
    ui.id,
    'original',
    's3',
    'tenants/SeedTNNTAAA1/seed/creator-icon/icon-1.jpg',
    'image/jpeg',
    11000,
    512,
    512
FROM user_images ui
WHERE ui.id = '018f0f31-0004-7000-8000-000000000003'::uuid
ON CONFLICT (id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    user_image_id = EXCLUDED.user_image_id,
    label = EXCLUDED.label,
    storage_provider = EXCLUDED.storage_provider,
    object_key = EXCLUDED.object_key,
    content_type = EXCLUDED.content_type,
    file_size_bytes = EXCLUDED.file_size_bytes,
    width = EXCLUDED.width,
    height = EXCLUDED.height;

UPDATE users
SET icon_image_id = '018f0f31-0004-7000-8000-000000000003'::uuid
WHERE public_id = 'RmodMMBRAAA3';
