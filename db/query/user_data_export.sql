-- A reader's download of what the install keeps about them. The reader's own
-- connection requests it and reads it back, under the member isolation the
-- table carries. The worker builds it and purges it as the maintenance role,
-- which reads every tenant's rows: the List…ForDataExport queries below are
-- what the archive is made of, one per file, and each names the tenant and
-- the reader itself rather than counting on a policy to.
--
-- A title is the one the locale the archive is written in shows, falling back
-- the way the storefront's own reads do.

-- name: CreateUserDataExport :one
-- No row when the reader already has a request the worker has neither built
-- nor given up on.
INSERT INTO user_data_exports (id, tenant_id, user_id)
VALUES (sqlc.arg('id'), sqlc.arg('tenant_id'), sqlc.arg('user_id'))
ON CONFLICT (tenant_id, user_id) WHERE ready_at IS NULL AND failed_at IS NULL DO NOTHING
RETURNING *;

-- name: GetLatestUserDataExport :one
-- The reader's latest request that has not expired, which is the one their
-- account shows.
SELECT *
FROM user_data_exports
WHERE tenant_id = sqlc.arg('tenant_id')
    AND user_id = sqlc.arg('user_id')
    AND (expires_at IS NULL OR expires_at > sqlc.arg('now')::timestamptz)
ORDER BY requested_at DESC,
    id DESC
LIMIT 1;

-- name: GetDownloadableUserDataExport :one
-- The reader's latest archive that is ready and has not expired. A request
-- made after it is still being built does not take it away.
SELECT *
FROM user_data_exports
WHERE tenant_id = sqlc.arg('tenant_id')
    AND user_id = sqlc.arg('user_id')
    AND ready_at IS NOT NULL
    AND expires_at > sqlc.arg('now')::timestamptz
ORDER BY requested_at DESC,
    id DESC
LIMIT 1;

-- name: ClaimUserDataExport :one
-- Takes up the oldest request no worker is building: one never claimed, or
-- one whose claim is older than stale_before, which a worker that died
-- mid-build left behind. A request whose account is gone is the purge's.
UPDATE user_data_exports
SET claimed_at = sqlc.arg('claimed_at')
WHERE id = (
        SELECT d.id
        FROM user_data_exports d
        WHERE d.ready_at IS NULL
            AND d.failed_at IS NULL
            AND d.user_id IS NOT NULL
            AND (
                d.claimed_at IS NULL
                OR d.claimed_at < sqlc.arg('stale_before')::timestamptz
            )
        ORDER BY d.requested_at,
            d.id
        LIMIT 1
        FOR UPDATE SKIP LOCKED
    )
RETURNING *;

-- name: MarkUserDataExportReady :one
-- Records the stored archive, as long as the claim is still the one that
-- built it and the account still exists. No row otherwise, and the archive is
-- then nobody's.
UPDATE user_data_exports
SET ready_at = sqlc.arg('ready_at'),
    expires_at = sqlc.arg('expires_at'),
    object_key = sqlc.arg('object_key'),
    size_bytes = sqlc.arg('size_bytes')
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id')
    AND claimed_at = sqlc.arg('claimed_at')
    AND ready_at IS NULL
    AND failed_at IS NULL
    AND user_id IS NOT NULL
RETURNING *;

-- name: FailUserDataExport :execrows
-- Gives up on a request under the claim that built it.
UPDATE user_data_exports
SET failed_at = sqlc.arg('failed_at'),
    expires_at = sqlc.arg('expires_at')
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id')
    AND claimed_at = sqlc.arg('claimed_at')
    AND ready_at IS NULL
    AND failed_at IS NULL;

-- name: ListPurgeableUserDataExports :many
-- The requests the purge takes: those whose time is up, and those whose
-- account is gone, archive and all.
SELECT id,
    object_key
FROM user_data_exports
WHERE (
        expires_at IS NOT NULL
        AND expires_at <= sqlc.arg('now')::timestamptz
    )
    OR user_id IS NULL
ORDER BY id
LIMIT sqlc.arg('limit');

-- name: DeleteUserDataExports :execrows
DELETE FROM user_data_exports
WHERE id = ANY(sqlc.arg('ids')::uuid[]);

-- name: GetUserForDataExport :one
-- The account itself. The password, its hash, and the second factor's secret
-- are not the reader's data but the means to sign in as them, so the archive
-- says only whether there is one.
SELECT u.public_id,
    u.email,
    u.name,
    u.status,
    u.created_at,
    u.email_verified_at,
    u.birth_date,
    u.last_locale,
    (u.password_hash IS NOT NULL)::boolean AS has_password,
    m.enabled_at AS mfa_enabled_at
FROM users u
    LEFT JOIN user_mfa_totp m ON m.tenant_id = u.tenant_id
    AND m.user_id = u.id
WHERE u.tenant_id = sqlc.arg('tenant_id')
    AND u.id = sqlc.arg('user_id');

-- name: ListUserIdentitiesForDataExport :many
-- The Apple and Google accounts linked to sign in with. The refresh token is
-- the install's credential with the provider, not the reader's.
SELECT provider,
    email_at_link,
    created_at
FROM user_identities
WHERE tenant_id = sqlc.arg('tenant_id')
    AND user_id = sqlc.arg('user_id')
ORDER BY created_at,
    id;

-- name: ListUserPasskeysForDataExport :many
-- The passkeys registered to sign in with. The key material is what the
-- passkey proves itself with, not something about the reader.
SELECT public_id,
    name,
    relying_party,
    created_at,
    last_used_at
FROM user_webauthn_credentials
WHERE tenant_id = sqlc.arg('tenant_id')
    AND user_id = sqlc.arg('user_id')
ORDER BY created_at,
    id;

-- name: ListFollowsForDataExport :many
-- Every follow, of a series, an episode, or an Author, oldest first.
SELECT f.kind::text AS kind,
    f.public_id::text AS public_id,
    f.name::text AS name,
    f.created_at::timestamptz AS created_at
FROM (
        SELECT 'series' AS kind,
            s.public_id,
            COALESCE(st.title, '') AS name,
            sf.created_at
        FROM series_follows sf
            JOIN series s ON s.tenant_id = sf.tenant_id
            AND s.id = sf.series_id
            LEFT JOIN LATERAL series_translation_for(s.id, sqlc.arg('locale')::text) st ON TRUE
        WHERE sf.tenant_id = sqlc.arg('tenant_id')
            AND sf.user_id = sqlc.arg('user_id')
        UNION ALL
        SELECT 'episode' AS kind,
            e.public_id,
            COALESCE(et.title, '') AS name,
            ef.created_at
        FROM episode_follows ef
            JOIN episodes e ON e.tenant_id = ef.tenant_id
            AND e.id = ef.episode_id
            LEFT JOIN LATERAL episode_translation_for(e.id, sqlc.arg('locale')::text) et ON TRUE
        WHERE ef.tenant_id = sqlc.arg('tenant_id')
            AND ef.user_id = sqlc.arg('user_id')
        UNION ALL
        SELECT 'creator' AS kind,
            c.public_id,
            c.name,
            cf.created_at
        FROM creator_follows cf
            JOIN creators c ON c.tenant_id = cf.tenant_id
            AND c.id = cf.creator_id
        WHERE cf.tenant_id = sqlc.arg('tenant_id')
            AND cf.user_id = sqlc.arg('user_id')
    ) f
ORDER BY f.created_at,
    f.kind,
    f.public_id;

-- name: ListReadingPositionsForDataExport :many
-- Where the reader stopped in each episode they opened.
SELECT s.public_id AS series_public_id,
    COALESCE(st.title, '')::text AS series_title,
    e.public_id AS episode_public_id,
    COALESCE(et.title, '')::text AS episode_title,
    e.order_index AS episode_order_index,
    p.page_index,
    p.page_count,
    p.updated_at
FROM episode_reading_positions p
    JOIN episodes e ON e.tenant_id = p.tenant_id
    AND e.id = p.episode_id
    JOIN series s ON s.tenant_id = e.tenant_id
    AND s.id = e.series_id
    LEFT JOIN LATERAL series_translation_for(s.id, sqlc.arg('locale')::text) st ON TRUE
    LEFT JOIN LATERAL episode_translation_for(e.id, sqlc.arg('locale')::text) et ON TRUE
WHERE p.tenant_id = sqlc.arg('tenant_id')
    AND p.user_id = sqlc.arg('user_id')
ORDER BY p.updated_at,
    e.id;

-- name: ListEpisodeReadsForDataExport :many
-- The reading history: each episode read, and when.
SELECT s.public_id AS series_public_id,
    COALESCE(st.title, '')::text AS series_title,
    e.public_id AS episode_public_id,
    COALESCE(et.title, '')::text AS episode_title,
    e.order_index AS episode_order_index,
    r.read_at
FROM episode_reads r
    JOIN episodes e ON e.tenant_id = r.tenant_id
    AND e.id = r.episode_id
    JOIN series s ON s.tenant_id = e.tenant_id
    AND s.id = e.series_id
    LEFT JOIN LATERAL series_translation_for(s.id, sqlc.arg('locale')::text) st ON TRUE
    LEFT JOIN LATERAL episode_translation_for(e.id, sqlc.arg('locale')::text) et ON TRUE
WHERE r.tenant_id = sqlc.arg('tenant_id')
    AND r.user_id = sqlc.arg('user_id')
ORDER BY r.read_at,
    r.id;

-- name: ListEpisodeRatingsForDataExport :many
SELECT s.public_id AS series_public_id,
    COALESCE(st.title, '')::text AS series_title,
    e.public_id AS episode_public_id,
    COALESCE(et.title, '')::text AS episode_title,
    e.order_index AS episode_order_index,
    r.score,
    r.created_at
FROM episode_ratings r
    JOIN episodes e ON e.tenant_id = r.tenant_id
    AND e.id = r.episode_id
    JOIN series s ON s.tenant_id = e.tenant_id
    AND s.id = e.series_id
    LEFT JOIN LATERAL series_translation_for(s.id, sqlc.arg('locale')::text) st ON TRUE
    LEFT JOIN LATERAL episode_translation_for(e.id, sqlc.arg('locale')::text) et ON TRUE
WHERE r.tenant_id = sqlc.arg('tenant_id')
    AND r.user_id = sqlc.arg('user_id')
ORDER BY r.created_at,
    e.id;

-- name: ListEpisodeCommentsForDataExport :many
-- Every comment the reader posted, in whatever state it is in now. Which
-- member of staff approved or hid one is the tenant's record, not theirs.
SELECT c.public_id,
    s.public_id AS series_public_id,
    COALESCE(st.title, '')::text AS series_title,
    e.public_id AS episode_public_id,
    COALESCE(et.title, '')::text AS episode_title,
    e.order_index AS episode_order_index,
    c.body,
    c.status,
    c.hidden_reason,
    c.created_at,
    c.published_at,
    c.hidden_at,
    c.withdrawn_at
FROM episode_comments c
    JOIN episodes e ON e.tenant_id = c.tenant_id
    AND e.id = c.episode_id
    JOIN series s ON s.tenant_id = e.tenant_id
    AND s.id = e.series_id
    LEFT JOIN LATERAL series_translation_for(s.id, sqlc.arg('locale')::text) st ON TRUE
    LEFT JOIN LATERAL episode_translation_for(e.id, sqlc.arg('locale')::text) et ON TRUE
WHERE c.tenant_id = sqlc.arg('tenant_id')
    AND c.user_id = sqlc.arg('user_id')
ORDER BY c.created_at,
    c.id;

-- name: ListEpisodeCommentReportsForDataExport :many
-- Every report the reader made of a comment. The comment is named by its ID
-- alone: its body is its author's, not the reporter's.
SELECT c.public_id AS comment_public_id,
    r.reason,
    r.note,
    r.status,
    r.created_at,
    r.resolved_at
FROM episode_comment_reports r
    JOIN episode_comments c ON c.tenant_id = r.tenant_id
    AND c.id = r.comment_id
WHERE r.tenant_id = sqlc.arg('tenant_id')
    AND r.reporter_user_id = sqlc.arg('user_id')
ORDER BY r.created_at,
    r.id;

-- name: ListPurchasesForDataExport :many
-- Every purchase, oldest first, with what ListMyPurchasesDesc answers for a
-- row: an episode, a volume, the rest of a series, or a pack of coins. Unlike
-- the library, no surface leaves a purchase out.
SELECT p.id,
    p.kind,
    p.price_at_purchase,
    p.currency,
    p.expires_at,
    p.revoked_at,
    p.refunded_amount,
    p.refunded_at,
    p.purchased_at,
    p.provider,
    p.store,
    COALESCE(ct.coins, 0)::integer AS coins_spent,
    e.public_id AS episode_public_id,
    COALESCE(et.title, '')::text AS episode_title,
    e.order_index AS episode_order_index,
    v.public_id AS volume_public_id,
    v.title AS volume_title,
    p.series_bundle_id,
    cp.public_id AS coin_pack_public_id,
    cpp.coins AS coin_pack_coins,
    cpp.bonus_coins AS coin_pack_bonus_coins,
    s.public_id AS series_public_id,
    COALESCE(str.title, '')::text AS series_title
FROM purchases p
    LEFT JOIN coin_transactions ct ON ct.tenant_id = p.tenant_id
    AND ct.purchase_id = p.id
    LEFT JOIN episodes e ON e.tenant_id = p.tenant_id
    AND e.id = p.episode_id
    LEFT JOIN LATERAL episode_translation_for(e.id, sqlc.arg('locale')::text) et ON TRUE
    LEFT JOIN volumes v ON v.tenant_id = p.tenant_id
    AND v.id = p.volume_id
    LEFT JOIN series_bundles b ON b.tenant_id = p.tenant_id
    AND b.id = p.series_bundle_id
    LEFT JOIN tenant_coin_packs cp ON cp.tenant_id = p.tenant_id
    AND cp.id = p.coin_pack_id
    LEFT JOIN coin_pack_purchases cpp ON cpp.tenant_id = p.tenant_id
    AND cpp.purchase_id = p.id
    LEFT JOIN series s ON s.tenant_id = p.tenant_id
    AND s.id = COALESCE(e.series_id, v.series_id, b.series_id)
    LEFT JOIN LATERAL series_translation_for(s.id, sqlc.arg('locale')::text) str ON TRUE
WHERE p.tenant_id = sqlc.arg('tenant_id')
    -- The cast keeps this a plain uuid: a deleted buyer's NULL is nobody's.
    AND p.user_id = sqlc.arg('user_id')::uuid
ORDER BY p.purchased_at,
    p.id;

-- name: ListCoinTransactionsForDataExport :many
-- Every coin the reader was granted or spent, oldest first.
SELECT ct.kind,
    ct.coins,
    ct.purchase_id,
    ct.created_at
FROM coin_transactions ct
WHERE ct.tenant_id = sqlc.arg('tenant_id')
    AND ct.user_id = sqlc.arg('user_id')::uuid
ORDER BY ct.created_at,
    ct.id;

-- name: ListSubscriptionsForDataExport :many
-- Every subscription, on the site or through the app's store, with the plan
-- it is to. The provider's own IDs are the tenant's record with the provider.
SELECT sp.public_id AS plan_public_id,
    sp.name AS plan_name,
    sub.provider,
    sub.status,
    sub.current_period_end,
    sub.cancel_at_period_end,
    sub.created_at,
    sub.updated_at
FROM subscriptions sub
    JOIN subscription_plans sp ON sp.tenant_id = sub.tenant_id
    AND sp.id = sub.plan_id
WHERE sub.tenant_id = sqlc.arg('tenant_id')
    AND sub.user_id = sqlc.arg('user_id')::uuid
ORDER BY sub.created_at,
    sub.id;

-- name: GetNotificationSettingsForDataExport :one
-- The reader's notification settings as saved. No row is a reader who saved
-- none, which the install keeps nothing about.
SELECT *
FROM user_notification_settings
WHERE tenant_id = sqlc.arg('tenant_id')
    AND user_id = sqlc.arg('user_id');

-- name: GetViewerPreferencesForDataExport :one
SELECT *
FROM user_viewer_preferences
WHERE tenant_id = sqlc.arg('tenant_id')
    AND user_id = sqlc.arg('user_id');

-- name: ListPageConsentsForDataExport :many
-- Every version of the terms of service or the privacy policy the reader
-- agreed to, and when.
SELECT pg.slug,
    pt.locale,
    pt.title,
    pv.version_number,
    c.agreed_at
FROM user_page_consents c
    JOIN page_versions pv ON pv.tenant_id = c.tenant_id
    AND pv.id = c.page_version_id
    JOIN page_translations pt ON pt.tenant_id = pv.tenant_id
    AND pt.id = pv.translation_id
    JOIN pages pg ON pg.tenant_id = pt.tenant_id
    AND pg.id = pt.page_id
WHERE c.tenant_id = sqlc.arg('tenant_id')
    AND c.user_id = sqlc.arg('user_id')
ORDER BY c.agreed_at,
    c.page_version_id;

-- name: ListAccessTicketsForDataExport :many
-- Every episode staff opened to the reader. The note is staff's to one
-- another, and is left out like the contact inbox's.
SELECT a.public_id,
    s.public_id AS series_public_id,
    COALESCE(st.title, '')::text AS series_title,
    e.public_id AS episode_public_id,
    COALESCE(et.title, '')::text AS episode_title,
    e.order_index AS episode_order_index,
    a.source,
    a.created_at,
    a.expires_at,
    a.revoked_at
FROM access_tickets a
    JOIN episodes e ON e.tenant_id = a.tenant_id
    AND e.id = a.episode_id
    JOIN series s ON s.tenant_id = e.tenant_id
    AND s.id = e.series_id
    LEFT JOIN LATERAL series_translation_for(s.id, sqlc.arg('locale')::text) st ON TRUE
    LEFT JOIN LATERAL episode_translation_for(e.id, sqlc.arg('locale')::text) et ON TRUE
WHERE a.tenant_id = sqlc.arg('tenant_id')
    AND a.user_id = sqlc.arg('user_id')
ORDER BY a.created_at,
    a.id;

-- name: ListContactMessagesForDataExport :many
-- Every message the reader sent through the contact form while signed in.
-- Who on staff handled it, and the note staff keep on it, are the tenant's.
SELECT id,
    public_id,
    reply_to_email,
    subject,
    body,
    created_at,
    handled_at
FROM contact_messages
WHERE tenant_id = sqlc.arg('tenant_id')
    AND user_id = sqlc.arg('user_id')::uuid
ORDER BY created_at,
    id;

-- name: ListContactMessageEntriesForDataExport :many
-- The replies on those messages, the reader's and staff's alike: what staff
-- wrote is what the reader was sent, and a reader's names the address they
-- wrote back from.
SELECT contact_message_id,
    direction,
    body,
    from_email,
    created_at
FROM contact_message_entries
WHERE tenant_id = sqlc.arg('tenant_id')
    AND contact_message_id = ANY(sqlc.arg('contact_message_ids')::uuid[])
ORDER BY created_at,
    id;
