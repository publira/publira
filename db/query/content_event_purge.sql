-- RecordContentEventPurge records that a purge is about to delete a tenant's
-- events before purged_before. It never moves the mark back, so a run under a
-- period that was lengthened since cannot hide what an earlier run deleted.
-- name: RecordContentEventPurge :exec
INSERT INTO content_event_purges (tenant_id, purged_before)
VALUES (sqlc.arg(tenant_id), sqlc.arg(purged_before))
ON CONFLICT (tenant_id) DO UPDATE
SET purged_before = EXCLUDED.purged_before,
    updated_at = now()
WHERE content_event_purges.purged_before < EXCLUDED.purged_before;

-- name: ListContentEventPurges :many
SELECT tenant_id, purged_before
FROM content_event_purges
ORDER BY tenant_id;
