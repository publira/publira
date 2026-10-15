-- COLUMN: purchases staff_refund_recorded_attempts
-- The staff attempts whose refund has been written to the audit log. Several
-- requests can see the same attempt through to the provider: one racing
-- another, or one finishing what an interrupted request left unasked. The
-- request that adds its attempt here is the one that records the refund, in
-- the same transaction, so each attempt the provider carries out leaves one
-- audit entry naming who asked for it and why. Each attempt is kept rather
-- than the latest alone, since a notification that a refund failed moves the
-- purchase on to its next attempt, and that attempt can be recorded before
-- the request that made the earlier refund gets to record it.
--
-- A constant default makes the column a change to the catalog alone, so the
-- ACCESS EXCLUSIVE lock it takes on purchases is brief.
ALTER TABLE purchases
    ADD COLUMN staff_refund_recorded_attempts integer[] DEFAULT '{}' NOT NULL;
