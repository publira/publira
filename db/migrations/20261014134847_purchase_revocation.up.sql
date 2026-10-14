-- A purchase stops opening its episode for more than one reason: the money
-- went back to the reader in full, the reader disputed the charge with their
-- bank, or staff took it back. refunded_at answers only the first, and it is
-- also what a royalty statement reads to leave a sale out, so a dispute that
-- may yet be decided for the tenant cannot be written there. The entitlement
-- reads these columns instead, which name every reason in one place.
--
-- ADD COLUMN takes an ACCESS EXCLUSIVE lock on purchases until this file
-- commits, so nothing here reads or writes a row of it: the constraints are
-- added NOT VALID, the next migration copies the refunds already recorded, and
-- the one after validates the constraints under a lock that lets reads and
-- writes go on.

-- COLUMN: purchases revoked_at
-- When the purchase stopped opening its episode. NULL is a purchase that still
-- does, as long as its reading period has not run out.
ALTER TABLE purchases
    ADD COLUMN revoked_at timestamp with time zone;

-- COLUMN: purchases revocation_reason
-- Why it stopped: a full refund, a dispute of the charge, or staff. Set with
-- revoked_at and never without it.
ALTER TABLE purchases
    ADD COLUMN revocation_reason text;

-- CONSTRAINT: purchases purchases_revocation_reason_check
ALTER TABLE ONLY purchases
    ADD CONSTRAINT purchases_revocation_reason_check CHECK ((((revoked_at IS NULL) = (revocation_reason IS NULL)) AND ((revocation_reason IS NULL) OR (revocation_reason = ANY (ARRAY['refund'::text, 'dispute'::text, 'staff'::text]))))) NOT VALID;

-- CONSTRAINT: purchases purchases_refund_revokes_check
-- A full refund always revokes the purchase, so a write that records one and
-- leaves the purchase open is refused rather than left opening an episode the
-- reader has their money back for. The revocation keeps the reason it was
-- given first: a refund that follows a dispute does not rewrite it.
ALTER TABLE ONLY purchases
    ADD CONSTRAINT purchases_refund_revokes_check CHECK (((refunded_at IS NULL) OR (revoked_at IS NOT NULL))) NOT VALID;
