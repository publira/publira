DROP TABLE store_subscription_intents;

DROP VIEW live_subscriptions;

-- CREATE OR REPLACE cannot take the new columns back off the view, so it is
-- recreated as the migration that added it left it.
DROP VIEW billed_subscriptions;

-- A store subscription names none of Stripe's ids, which are NOT NULL again
-- below, so it cannot outlive the columns that tell it apart.
DELETE FROM subscriptions
WHERE provider <> 'stripe';

ALTER TABLE ONLY subscriptions
    DROP CONSTRAINT subscriptions_store_subscription_id_check,
    DROP CONSTRAINT subscriptions_provider_check;

ALTER TABLE subscriptions
    ALTER COLUMN stripe_customer_id SET NOT NULL,
    ALTER COLUMN stripe_subscription_id SET NOT NULL,
    ALTER COLUMN stripe_price_id SET NOT NULL;

ALTER TABLE subscriptions
    DROP COLUMN is_test,
    DROP COLUMN store_product_id,
    DROP COLUMN store_subscription_id,
    DROP COLUMN provider;

CREATE VIEW billed_subscriptions WITH (security_invoker = true) AS
SELECT s.*
FROM subscriptions s
WHERE s.status IN ('trialing', 'active', 'past_due', 'unpaid', 'paused');

ALTER TABLE ONLY subscription_plans
    DROP CONSTRAINT subscription_plans_tenant_google_play_product_id_key,
    DROP CONSTRAINT subscription_plans_tenant_app_store_product_id_key,
    DROP CONSTRAINT subscription_plans_store_product_id_check;

ALTER TABLE subscription_plans
    DROP COLUMN google_play_product_id,
    DROP COLUMN app_store_product_id;
