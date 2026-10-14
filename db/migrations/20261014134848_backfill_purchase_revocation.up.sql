-- Every purchase refunded in full until now is revoked by that refund.
--
-- A file of its own so the update runs outside the previous migration's ACCESS
-- EXCLUSIVE lock: here it takes the row locks of the purchases it rewrites and
-- nothing more, so reads of purchases, and writes to every other row, go on.
UPDATE purchases
SET revoked_at = refunded_at,
    revocation_reason = 'refund'
WHERE refunded_at IS NOT NULL
    AND revoked_at IS NULL;
