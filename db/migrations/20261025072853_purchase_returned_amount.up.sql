-- FUNCTION: purchase_returned_amount
-- What of a purchase's price_at_purchase went back to the reader: the whole of
-- it once a dispute of the payment was lost, since the reader's bank took the
-- payment back whatever had been refunded before, and otherwise what refunds
-- have returned so far, none while none has arrived. What a purchase earned is
-- its price less this, which is how the console's revenue statistics net a
-- sale, so a refund and a lost dispute take a sale back in the same way.
--
-- A dispute still open, or one the tenant won, returns nothing here: the money
-- is the tenant's until the provider reports the dispute lost.
CREATE FUNCTION purchase_returned_amount(price integer, refunded_amount integer, dispute_lost_at timestamp with time zone) RETURNS integer
    LANGUAGE sql
    IMMUTABLE
    PARALLEL SAFE
AS $$
    SELECT CASE
        WHEN purchase_returned_amount.dispute_lost_at IS NOT NULL
            THEN purchase_returned_amount.price
        ELSE COALESCE(purchase_returned_amount.refunded_amount, 0)
    END
$$;
