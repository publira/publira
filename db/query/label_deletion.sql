-- Deleting a label, which the console allows only while nothing that has to
-- be kept refers to it: no series under it, no subscription plan scoped to it,
-- and no promotion code for it that is still live or that someone redeemed.
-- What is the label's alone goes with it, in the transaction that deletes it.
--
-- The statements run in the order they appear here. The lock comes first and
-- the check after it, in a statement of its own: READ COMMITTED freezes a
-- statement's snapshot at its start, so a check made inside the statement that
-- waited for the lock would still answer from before the wait.

-- name: LockLabelForDeletion :one
-- The label, with the name the audit entry keeps once no row is left to join.
-- The row lock is what keeps a reference from arriving while the label is
-- deleted: a series and a plan scope take a key share lock on the label row
-- through their foreign keys when they are written, and so does the check a
-- new promotion code makes of its label, all of which wait for this one and
-- find the label gone once it commits.
SELECT id,
    public_id,
    name
FROM labels
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id')
FOR UPDATE;

-- name: GetLabelDeletionBlocker :one
-- The first of the references that keep the label from being deleted, in the
-- order the refusal names them, or '' when there is none:
--
--   series             a series under the label, whatever its state
--   subscription_plan  a subscription plan whose scope names the label
--   promotion_code     a promotion code for the label that has not been
--                      deleted, or that a redemption, a purchase, or a store
--                      payment sheet names, deleted or not
SELECT (
        CASE
            WHEN EXISTS (
                SELECT 1
                FROM series s
                WHERE s.tenant_id = sqlc.arg('tenant_id')
                    AND s.label_id = sqlc.arg('label_id')::uuid
            ) THEN 'series'
            WHEN EXISTS (
                SELECT 1
                FROM subscription_plan_targets spt
                WHERE spt.tenant_id = sqlc.arg('tenant_id')
                    AND spt.label_id = sqlc.arg('label_id')::uuid
            ) THEN 'subscription_plan'
            WHEN EXISTS (
                SELECT 1
                FROM promotion_codes pc
                WHERE pc.tenant_id = sqlc.arg('tenant_id')
                    AND pc.target_kind = 'label'
                    AND pc.target_id = sqlc.arg('label_id')::uuid
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

-- name: DeleteLabelByIDForTenant :exec
-- The label, and through the foreign key that cascades from it its eye-catch
-- images and their variants. The objects of those images are left to the
-- orphan image sweep.
DELETE FROM labels
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id');

-- name: DeleteLabelPromotionCodes :exec
-- The promotion codes for the label, every one of which was deleted before
-- anything used it, since any other refuses the deletion. A code is not tied
-- to the label by a foreign key, so it would otherwise stay behind naming
-- nothing.
DELETE FROM promotion_codes
WHERE tenant_id = sqlc.arg('tenant_id')
    AND target_kind = 'label'
    AND target_id = sqlc.arg('label_id')::uuid;
