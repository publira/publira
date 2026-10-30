-- COLUMN: purchases staff_refund_requested_total
-- The refunded total a refund in part staff asked the provider for brings the
-- purchase to, while the provider has yet to report it. It marks the request
-- as one in flight: a retry of the same amount is sent under the same
-- idempotency key, and the notification that records a total reaching it clears
-- it and moves the purchase on to staff's next attempt, so the next refund in
-- part is a new request rather than the provider's answer to this one. NULL
-- while no refund in part is waiting.
--
-- Without a default the column is a change to the catalog alone, so the ACCESS
-- EXCLUSIVE lock it takes on purchases is brief.
ALTER TABLE purchases
    ADD COLUMN staff_refund_requested_total integer;
