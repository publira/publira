-- Every purchase that names a checkout was created from a Stripe one, which
-- until now was the only provider there was.
--
-- A file of its own so the update runs outside the previous migration's ACCESS
-- EXCLUSIVE lock: here it takes the row locks of the purchases it rewrites and
-- nothing more, so reads of purchases, and writes to every other row, go on.
UPDATE purchases
SET provider = 'stripe'
WHERE provider_checkout_id IS NOT NULL;
