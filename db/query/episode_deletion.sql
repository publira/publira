-- Deleting an episode, which the console allows only while nothing that has to
-- be kept refers to it: a record of money a reader paid or was granted, a
-- royalty statement, a promotion code someone redeemed, or a published volume.
-- What is the episode's alone goes with it, in the transaction that deletes it.
--
-- The statements run in the order they appear here. The locks come first and
-- the check after them, in statements of their own: READ COMMITTED freezes a
-- statement's snapshot at its start, so a check made inside the statement that
-- waited for a lock would still answer from before the wait.

-- name: LockEpisodeForDeletion :one
-- The episode, with the title the audit entry keeps once no row is left to
-- join. The row lock is what keeps a reference from arriving while the episode
-- is deleted: every row that refers to the episode through a foreign key takes
-- a key share lock on it when it is written, which waits for this one, and
-- fails once the episode is gone.
SELECT e.id,
    e.public_id,
    e.series_id,
    et.title
FROM episodes e
    CROSS JOIN LATERAL episode_translation_for(e.id, '') et
WHERE e.tenant_id = sqlc.arg('tenant_id')
    AND e.id = sqlc.arg('id')
FOR UPDATE OF e;

-- name: LockVolumesHoldingEpisode :many
-- The volumes that hold the episode, so none is published between the check
-- and the deletion that takes the episode out of the drafts among them.
-- Publishing a volume updates its row, which a share lock holds off.
SELECT v.id
FROM volumes v
    JOIN volume_episodes ve ON ve.tenant_id = v.tenant_id
        AND ve.volume_id = v.id
WHERE v.tenant_id = sqlc.arg('tenant_id')
    AND ve.episode_id = sqlc.arg('episode_id')::uuid
ORDER BY v.id
FOR SHARE OF v;

-- name: LockSeriesBundlesNamingEpisode :many
-- The bundle checkouts that name the episode, so none is paid for between the
-- check and the deletion that takes the episode out of the unpaid ones. The
-- purchase that records a bundle's payment refers to the bundle rather than to
-- its episodes, and takes a key share lock on the bundle row, which this lock
-- holds off.
SELECT b.id
FROM series_bundles b
    JOIN series_bundle_episodes sbe ON sbe.tenant_id = b.tenant_id
        AND sbe.series_bundle_id = b.id
WHERE b.tenant_id = sqlc.arg('tenant_id')
    AND sbe.episode_id = sqlc.arg('episode_id')::uuid
ORDER BY b.id
FOR UPDATE OF b;

-- name: GetEpisodeDeletionBlocker :one
-- The first of the references that keep the episode from being deleted, in the
-- order the refusal names them, or '' when there is none:
--
--   purchase          a purchase, a rental, or a tip on it, through the
--                     payment provider or granted by staff, and a volume or a
--                     bundle someone bought with it
--   store_purchase    a purchase through the App Store or Google Play
--   access_ticket     an access ticket, revoked or expired ones included
--   royalty_statement a line of a royalty statement, or the subscription
--                     revenue a statement gave it a part of
--   coin_payment      a purchase paid with the tenant's coins
--   promotion_code    a promotion code for it that someone redeemed, deleted
--                     or not
--   published_volume  a published volume that holds it
--
-- Each kind of purchase is named once, by what paid for it, so a purchase
-- made with coins is a coin payment rather than a purchase.
SELECT (
        CASE
            WHEN EXISTS (
                SELECT 1
                FROM purchases p
                WHERE p.tenant_id = sqlc.arg('tenant_id')
                    AND p.episode_id = sqlc.arg('episode_id')::uuid
                    AND p.store IS NULL
                    AND NOT EXISTS (
                        SELECT 1
                        FROM coin_transactions ct
                        WHERE ct.tenant_id = p.tenant_id
                            AND ct.purchase_id = p.id
                    )
            )
            OR EXISTS (
                SELECT 1
                FROM volume_purchase_episodes vpe
                WHERE vpe.tenant_id = sqlc.arg('tenant_id')
                    AND vpe.episode_id = sqlc.arg('episode_id')::uuid
            )
            OR EXISTS (
                SELECT 1
                FROM series_bundle_episodes sbe
                    JOIN purchases p ON p.tenant_id = sbe.tenant_id
                        AND p.series_bundle_id = sbe.series_bundle_id
                WHERE sbe.tenant_id = sqlc.arg('tenant_id')
                    AND sbe.episode_id = sqlc.arg('episode_id')::uuid
            ) THEN 'purchase'
            WHEN EXISTS (
                SELECT 1
                FROM purchases p
                WHERE p.tenant_id = sqlc.arg('tenant_id')
                    AND p.episode_id = sqlc.arg('episode_id')::uuid
                    AND p.store IS NOT NULL
            ) THEN 'store_purchase'
            WHEN EXISTS (
                SELECT 1
                FROM access_tickets at
                WHERE at.tenant_id = sqlc.arg('tenant_id')
                    AND at.episode_id = sqlc.arg('episode_id')::uuid
            ) THEN 'access_ticket'
            WHEN EXISTS (
                SELECT 1
                FROM royalty_statement_lines l
                WHERE l.tenant_id = sqlc.arg('tenant_id')
                    AND l.episode_id = sqlc.arg('episode_id')::uuid
            )
            OR EXISTS (
                SELECT 1
                FROM royalty_statement_subscription_parts sp
                WHERE sp.tenant_id = sqlc.arg('tenant_id')
                    AND sp.episode_id = sqlc.arg('episode_id')::uuid
            ) THEN 'royalty_statement'
            WHEN EXISTS (
                SELECT 1
                FROM purchases p
                    JOIN coin_transactions ct ON ct.tenant_id = p.tenant_id
                        AND ct.purchase_id = p.id
                WHERE p.tenant_id = sqlc.arg('tenant_id')
                    AND p.episode_id = sqlc.arg('episode_id')::uuid
            ) THEN 'coin_payment'
            WHEN EXISTS (
                SELECT 1
                FROM promotion_codes pc
                    JOIN promotion_code_redemptions r ON r.tenant_id = pc.tenant_id
                        AND r.promotion_code_id = pc.id
                WHERE pc.tenant_id = sqlc.arg('tenant_id')
                    AND pc.target_kind = 'episode'
                    AND pc.target_id = sqlc.arg('episode_id')::uuid
            ) THEN 'promotion_code'
            WHEN EXISTS (
                SELECT 1
                FROM volume_episodes ve
                    JOIN volumes v ON v.tenant_id = ve.tenant_id
                        AND v.id = ve.volume_id
                WHERE ve.tenant_id = sqlc.arg('tenant_id')
                    AND ve.episode_id = sqlc.arg('episode_id')::uuid
                    AND v.is_published
            ) THEN 'published_volume'
            ELSE ''
        END
    )::text AS blocker;

-- name: DeleteEpisodeFromDraftVolumes :exec
-- A volume nobody can buy yet loses the episode and keeps the rest of its run.
DELETE FROM volume_episodes ve
USING volumes v
WHERE ve.tenant_id = sqlc.arg('tenant_id')
    AND ve.episode_id = sqlc.arg('episode_id')::uuid
    AND v.tenant_id = ve.tenant_id
    AND v.id = ve.volume_id
    AND NOT v.is_published;

-- name: DeleteEpisodeFromUnpaidSeriesBundles :exec
-- A bundle checkout nobody paid for, open or expired, loses the episode. The
-- bundles someone paid for refuse the deletion before this runs.
DELETE FROM series_bundle_episodes sbe
WHERE sbe.tenant_id = sqlc.arg('tenant_id')
    AND sbe.episode_id = sqlc.arg('episode_id')::uuid
    AND NOT EXISTS (
        SELECT 1
        FROM purchases p
        WHERE p.tenant_id = sbe.tenant_id
            AND p.series_bundle_id = sbe.series_bundle_id
    );

-- name: DeleteEpisodeContentEvents :exec
-- The views, completions, and the rest of what readers did on the episode. Its
-- foreign key restricts rather than cascades, so a deletion that forgot them
-- fails instead of taking them unnoticed. The daily figures already rebuilt
-- from them stay, as every past day's do.
DELETE FROM content_events
WHERE tenant_id = sqlc.arg('tenant_id')
    AND episode_id = sqlc.arg('episode_id')::uuid;

-- name: DeleteEpisodeByIDForTenant :exec
-- The episode, and through the foreign keys that cascade from it everything
-- that is its alone: its pages, eye-catch, translations, credits, listing, free
-- windows, campaign prices, review rounds, comments and their reports, follows,
-- reactions, reading positions, reads, and the checkouts and store intents
-- that named it. The objects of its images are left to the orphan image sweep.
DELETE FROM episodes
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id');

-- name: DeleteEpisodePromotionCodes :exec
-- The promotion codes for the episode, none of which anyone redeemed, since a
-- redeemed one refuses the deletion. A code is not tied to the episode by a
-- foreign key, so it would otherwise stay behind applying to nothing. Run it
-- after the episode is deleted, which takes the store intents that named such
-- a code with it.
DELETE FROM promotion_codes
WHERE tenant_id = sqlc.arg('tenant_id')
    AND target_kind = 'episode'
    AND target_id = sqlc.arg('episode_id')::uuid;
