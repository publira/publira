-- FUNCTION: payment_checkout_closed
-- Whether lifetime_seconds have passed since a checkout was last started,
-- after which the provider takes no payment of it and the server captures
-- none: a retry may be what made the provider's checkout, so its last start
-- bounds when it can be paid. The storefront page, the completion of a
-- payment, and the worker following a checkout each ask this, and sqlc cannot
-- share a predicate between queries, so the rule is written here once.
--
-- SECURITY INVOKER keeps it the caller's own, as reader_may_open_episode is.
CREATE FUNCTION payment_checkout_closed(last_started_at timestamptz, lifetime_seconds double precision) RETURNS boolean
    LANGUAGE sql
    STABLE
    PARALLEL SAFE
    SECURITY INVOKER
AS $$
    SELECT last_started_at <= now() - make_interval(secs => lifetime_seconds)
$$;
