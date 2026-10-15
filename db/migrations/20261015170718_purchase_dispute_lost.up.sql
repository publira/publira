-- A dispute the reader's bank decided against the tenant takes the payment
-- back for good, and the provider reports that as the dispute's outcome, never
-- as a refund. The purchase already stopped opening its episode when the
-- dispute was opened; the loss is about the money, which a royalty statement
-- then no longer counts as a sale.
--
-- ADD COLUMN takes an ACCESS EXCLUSIVE lock on purchases until this file
-- commits, so the constraint is added NOT VALID and the next migration
-- validates it under a lock that lets reads and writes go on.

-- COLUMN: purchases dispute_lost_at
-- When the provider reported the payment's dispute lost. NULL is a purchase
-- never disputed, one whose dispute is still open, and one whose dispute the
-- tenant won, which stays a sale.
ALTER TABLE purchases
    ADD COLUMN dispute_lost_at timestamp with time zone;

-- CONSTRAINT: purchases purchases_dispute_lost_revokes_check
-- A lost dispute always leaves the purchase revoked, so a write that would
-- reopen it, such as taking back a refund that failed, is refused rather than
-- left opening an episode the reader's bank has returned the money for.
ALTER TABLE ONLY purchases
    ADD CONSTRAINT purchases_dispute_lost_revokes_check CHECK (((dispute_lost_at IS NULL) OR (revoked_at IS NOT NULL))) NOT VALID;

-- COLUMN: unapplied_disputes lost_at
-- When the held dispute was reported lost, written onto the purchase with the
-- revocation once the purchase is created. NULL while it is not.
ALTER TABLE unapplied_disputes
    ADD COLUMN lost_at timestamp with time zone;
