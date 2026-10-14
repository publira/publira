-- COLUMN: purchases staff_refund_attempt
-- Which of staff's attempts to refund the purchase the next request belongs
-- to. The request is sent to the provider under an idempotency key that names
-- the purchase and this number, so a retry of the same attempt refunds nothing
-- twice, and the number moves on once the provider has refused or failed the
-- refund: under the same key the provider would only answer that failure
-- again.
--
-- A constant default makes the column a change to the catalog alone, so the
-- ACCESS EXCLUSIVE lock it takes on purchases is brief.
ALTER TABLE purchases
    ADD COLUMN staff_refund_attempt integer DEFAULT 0 NOT NULL;

