-- A purchase paid in a web payment provider's test mode is a test purchase,
-- as a store's sandbox one already is: a tenant tries its Stripe or PAY.JP
-- setup with test keys on the install it is about to go live on, and that
-- payment opens the episode while paying the tenant nothing. Royalty
-- statements and the daily stats already leave out every test purchase; what
-- stood in the way was the constraint that allowed the flag on a store
-- purchase alone.

-- CONSTRAINT: purchases purchases_store_transaction_check
-- A store purchase names its transaction, and only a purchase someone paid
-- through a store or a provider can be a test one: an admin-issued grant has
-- no test mode to come from.
--
-- Every row the previous constraint admitted is one this admits, so no row
-- already there can fail it, but a CHECK added valid is still checked against
-- every row under the ACCESS EXCLUSIVE lock this statement takes. It is added
-- NOT VALID instead, and the next migration validates it under a lock that
-- lets reads and writes go on.
ALTER TABLE ONLY purchases
    DROP CONSTRAINT purchases_store_transaction_check,
    ADD CONSTRAINT purchases_store_transaction_check CHECK ((((store IS NULL) = (store_transaction_id IS NULL)) AND ((NOT is_test) OR (store IS NOT NULL) OR (provider IS NOT NULL)))) NOT VALID;
