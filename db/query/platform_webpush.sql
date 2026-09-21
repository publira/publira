-- name: GetPlatformWebPushConfig :one
-- Returns no rows until the server has generated a key pair.
SELECT *
FROM platform_webpush_config
WHERE singleton = TRUE;

-- name: InsertPlatformWebPushKeyPair :execrows
-- Stores a freshly generated pair unless one is already there. Every process
-- that finds no row generates a pair of its own, and the primary key keeps the
-- first one stored: replacing it would orphan the subscriptions already made
-- against it.
INSERT INTO platform_webpush_config (
        singleton,
        vapid_public_key,
        vapid_private_key_encrypted
    )
VALUES (
        TRUE,
        sqlc.arg('vapid_public_key'),
        sqlc.arg('vapid_private_key_encrypted')
    )
ON CONFLICT (singleton) DO NOTHING;

-- name: LockPlatformWebPushConfig :one
-- Reads the row for update, so the revision a save compares against cannot
-- change between the comparison and the write.
SELECT *
FROM platform_webpush_config
WHERE singleton = TRUE
FOR UPDATE;

-- name: UpdatePlatformWebPushSubject :one
UPDATE platform_webpush_config
SET subject = sqlc.arg('subject')::text,
    revision = revision + 1,
    updated_at = NOW()
WHERE singleton = TRUE
RETURNING *;

-- name: GetPublishedWebPushPublicKey :one
-- The public key browsers subscribe with, read by the storefront role, which is
-- granted only the columns named here. No rows while Web Push is not
-- configured, so the key is never offered before a push could be signed.
SELECT vapid_public_key
FROM platform_webpush_config
WHERE singleton = TRUE
    AND subject IS NOT NULL;
