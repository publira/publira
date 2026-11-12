-- Deleting a creator, which the console allows only while nothing that has to
-- be kept refers to them: no credit on a series or an episode, no line of a
-- royalty statement, and no reader account linked to them. What is the
-- creator's alone goes with them, in the transaction that deletes them.
--
-- The statements run in the order they appear here. The lock comes first and
-- the check after it, in a statement of its own: READ COMMITTED freezes a
-- statement's snapshot at its start, so a check made inside the statement that
-- waited for the lock would still answer from before the wait.

-- name: LockCreatorForDeletion :one
-- The creator, with the name the audit entry keeps once no row is left to
-- join. The row lock is what keeps a reference from arriving while the creator
-- is deleted: a series or an episode credit and an account link take a key
-- share lock on the creator row through their foreign keys when they are
-- written, which waits for this one and fails once it commits. A royalty
-- statement line names its creator by no foreign key, so a close takes the
-- same key share lock on the creators of the lines it is about to write
-- (LockRoyaltyStatementCreators).
SELECT id,
    public_id,
    name
FROM creators
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id')
FOR UPDATE;

-- name: GetCreatorDeletionBlocker :one
-- The first of the references that keep the creator from being deleted, in
-- the order the refusal names them, or '' when there is none:
--
--   credit             a credit on a series or an episode, whatever its state
--   royalty_statement  a line of a royalty statement, which every subtotal
--                      naming the creator is a sum of
--   linked_account     a reader account linked to the creator
SELECT (
        CASE
            WHEN EXISTS (
                SELECT 1
                FROM series_creators sc
                WHERE sc.tenant_id = sqlc.arg('tenant_id')
                    AND sc.creator_id = sqlc.arg('creator_id')::uuid
            )
            OR EXISTS (
                SELECT 1
                FROM episode_creators ec
                WHERE ec.tenant_id = sqlc.arg('tenant_id')
                    AND ec.creator_id = sqlc.arg('creator_id')::uuid
            ) THEN 'credit'
            WHEN EXISTS (
                SELECT 1
                FROM royalty_statement_lines l
                WHERE l.tenant_id = sqlc.arg('tenant_id')
                    AND l.creator_id = sqlc.arg('creator_id')::uuid
            ) THEN 'royalty_statement'
            WHEN EXISTS (
                SELECT 1
                FROM creator_accounts ca
                WHERE ca.tenant_id = sqlc.arg('tenant_id')
                    AND ca.creator_id = sqlc.arg('creator_id')::uuid
            ) THEN 'linked_account'
            ELSE ''
        END
    )::text AS blocker;

-- name: DeleteCreatorByIDForTenant :exec
-- The creator, and through the foreign keys that cascade from them their icon
-- images and those images' variants, the reader follows of them, and their
-- follower count. The objects of the images are left to the orphan image
-- sweep. sitemap_entries is a view and drops the creator with the row.
DELETE FROM creators
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id');
