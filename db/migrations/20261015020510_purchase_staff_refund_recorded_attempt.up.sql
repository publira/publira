-- COLUMN: purchases staff_refund_recorded_attempt
-- The latest staff attempt whose refund has been written to the audit log, or
-- NULL before the first. Several requests can see the same attempt through to
-- the provider: one racing another, or one finishing what an interrupted
-- request left unasked. The request that moves this column up to its attempt
-- is the one that records the refund, so each attempt the provider carries out
-- leaves one audit entry naming who asked for it and why.
--
-- A nullable column with no default is a change to the catalog alone, so the
-- ACCESS EXCLUSIVE lock it takes on purchases is brief.
ALTER TABLE purchases
    ADD COLUMN staff_refund_recorded_attempt integer;
