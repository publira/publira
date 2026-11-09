-- Deleting a series, which the console allows only while it holds nothing and
-- nothing that has to be kept refers to it: no episode, no volume, no
-- subscription plan scoped to it, and no promotion code for it that is still
-- live or that someone redeemed. What is the series' alone goes with it, in
-- the transaction that deletes it.
--
-- The statements run in the order they appear here. The lock comes first and
-- the check after it, in a statement of its own: READ COMMITTED freezes a
-- statement's snapshot at its start, so a check made inside the statement that
-- waited for the lock would still answer from before the wait.

-- name: LockSeriesForDeletion :one
-- The series, with the title the audit entry keeps once no row is left to
-- join and the label the search index rereads without it. The row lock is
-- what keeps a reference from arriving while the series is deleted: an
-- episode, a volume, a plan scope, or a bundle checkout takes a key share lock
-- on the series row through its foreign key when it is written, and so does
-- the check a new promotion code makes of its series, all of which wait for
-- this one and find the series gone once it commits.
SELECT s.id,
    s.public_id,
    s.label_id,
    st.title
FROM series s
    CROSS JOIN LATERAL series_translation_for(s.id, '') st
WHERE s.tenant_id = sqlc.arg('tenant_id')
    AND s.id = sqlc.arg('id')
FOR UPDATE OF s;

-- name: GetSeriesDeletionBlocker :one
-- The first of the references that keep the series from being deleted, in the
-- order the refusal names them, or '' when there is none:
--
--   episode            an episode, whatever its state
--   volume             a volume, published or not
--   subscription_plan  a subscription plan whose scope names the series
--   promotion_code     a promotion code for the series that has not been
--                      deleted, or that a redemption, a purchase, or a store
--                      payment sheet names, deleted or not
SELECT (
        CASE
            WHEN EXISTS (
                SELECT 1
                FROM episodes e
                WHERE e.tenant_id = sqlc.arg('tenant_id')
                    AND e.series_id = sqlc.arg('series_id')::uuid
            ) THEN 'episode'
            WHEN EXISTS (
                SELECT 1
                FROM volumes v
                WHERE v.tenant_id = sqlc.arg('tenant_id')
                    AND v.series_id = sqlc.arg('series_id')::uuid
            ) THEN 'volume'
            WHEN EXISTS (
                SELECT 1
                FROM subscription_plan_targets spt
                WHERE spt.tenant_id = sqlc.arg('tenant_id')
                    AND spt.series_id = sqlc.arg('series_id')::uuid
            ) THEN 'subscription_plan'
            WHEN EXISTS (
                SELECT 1
                FROM promotion_codes pc
                WHERE pc.tenant_id = sqlc.arg('tenant_id')
                    AND pc.target_kind = 'series'
                    AND pc.target_id = sqlc.arg('series_id')::uuid
                    AND (
                        pc.deleted_at IS NULL
                        OR EXISTS (
                            SELECT 1
                            FROM promotion_code_redemptions r
                            WHERE r.tenant_id = pc.tenant_id
                                AND r.promotion_code_id = pc.id
                        )
                        OR EXISTS (
                            SELECT 1
                            FROM purchases p
                            WHERE p.tenant_id = pc.tenant_id
                                AND p.promotion_code_id = pc.id
                        )
                        OR EXISTS (
                            SELECT 1
                            FROM store_purchase_intents i
                            WHERE i.tenant_id = pc.tenant_id
                                AND i.promotion_code_id = pc.id
                        )
                    )
            ) THEN 'promotion_code'
            ELSE ''
        END
    )::text AS blocker;

-- name: DeleteSeriesContentEvents :exec
-- The series views, follows, and the rest of what readers did on the series
-- itself. Its foreign key restricts rather than cascades, so a deletion that
-- forgot them fails instead of taking them unnoticed. The daily figures
-- already rebuilt from them stay, as every past day's do.
DELETE FROM content_events
WHERE tenant_id = sqlc.arg('tenant_id')
    AND series_id = sqlc.arg('series_id')::uuid;

-- name: DeleteSeriesBundles :exec
-- The bundle checkouts started on the series. None of them was paid for: a
-- paid one keeps its episodes, which refuse their own deletion. Their foreign
-- key does not cascade, so they go here rather than with the series.
DELETE FROM series_bundles
WHERE tenant_id = sqlc.arg('tenant_id')
    AND series_id = sqlc.arg('series_id')::uuid;

-- name: DeleteSeriesByIDForTenant :exec
-- The series, and through the foreign keys that cascade from it everything
-- that is its alone: its translations, credits, genres and tags, listing,
-- cover images, wait-free and free-after settings, follows and the follower
-- counts and changes kept from them, its readers' wait-free tickets and daily
-- activity, and the rating counts derived from its episodes. The objects of
-- its images are left to the orphan image sweep.
DELETE FROM series
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id');

-- name: DeleteSeriesPromotionCodes :exec
-- The promotion codes for the series, every one of which was deleted before
-- anything used it, since any other refuses the deletion. A code is not tied
-- to the series by a foreign key, so it would otherwise stay behind naming
-- nothing.
DELETE FROM promotion_codes
WHERE tenant_id = sqlc.arg('tenant_id')
    AND target_kind = 'series'
    AND target_id = sqlc.arg('series_id')::uuid;
