-- COLUMN: purchases staff_refund_requested_amount
-- The amount of a refund in part staff asked the provider for, while the
-- provider has yet to make it. It marks the request as one in flight: a retry
-- of the same amount is sent under the same idempotency key, the key of the
-- purchase's current staff_refund_attempt, and once the provider reports the
-- refund that key made, it clears and the purchase moves on to staff's next
-- attempt, so the next refund in part is a new request rather than the
-- provider's answer to this one. NULL while no refund in part is waiting.
--
-- Without a default the column is a change to the catalog alone, so the ACCESS
-- EXCLUSIVE lock it takes on purchases is brief.
ALTER TABLE purchases
    ADD COLUMN staff_refund_requested_amount integer;
