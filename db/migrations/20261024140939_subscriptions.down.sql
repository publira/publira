-- A subscription is a reader paying the tenant every period, and Stripe goes on
-- billing it whatever this database holds. Rather than forgetting one, the
-- rollback refuses to run while any exists.
DO $$
BEGIN
    IF EXISTS (
            SELECT 1
            FROM subscriptions
        ) THEN RAISE EXCEPTION 'subscriptions exist; this migration cannot be rolled back without losing them';
    END IF;
END $$;

DROP TABLE subscriptions;

DROP TABLE subscription_plan_targets;

DROP TABLE subscription_plans;
