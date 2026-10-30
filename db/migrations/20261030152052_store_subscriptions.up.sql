-- A subscription plan sold through the App Store's or Google Play's in-app
-- purchase as well as through Stripe, and a subscription the app bought there
-- recorded as the same entitlement a Stripe subscription is.
--
-- Every statement here is a change to the catalog alone, under the ACCESS
-- EXCLUSIVE locks the ALTERs take until this file commits: the new columns are
-- nullable or carry a constant default, so no row is rewritten, and the CHECK
-- constraint is added NOT VALID. The index that makes a store subscription one
-- row is built concurrently by the next migration, and the one after it
-- validates the constraint.

-- COLUMN: subscription_plans app_store_product_id
-- The auto-renewable subscription the plan is sold as in the tenant's iOS app,
-- as App Store Connect names it. NULL when the app does not sell the plan.
-- Entered rather than derived, as an episode's price tier is: a plan is one
-- store product with a billing period the store owns, often one an existing
-- app already sells.
ALTER TABLE subscription_plans
    ADD COLUMN app_store_product_id text;

-- COLUMN: subscription_plans google_play_product_id
-- The subscription the plan is sold as in the tenant's Android app, as the Play
-- Console names it. NULL when the app does not sell the plan.
ALTER TABLE subscription_plans
    ADD COLUMN google_play_product_id text;

-- CONSTRAINT: subscription_plans subscription_plans_store_product_id_check
ALTER TABLE ONLY subscription_plans
    ADD CONSTRAINT subscription_plans_store_product_id_check CHECK (((char_length(app_store_product_id) >= 1) AND (char_length(google_play_product_id) >= 1)));

-- CONSTRAINT: subscription_plans subscription_plans_tenant_app_store_product_id_key
-- A store product is what a store subscription is bought as, so it names one
-- plan: a confirmed transaction is recorded on the plan of its product. A
-- tenant holds at most a few dozen plans, so the index builds under the lock
-- this file already holds.
ALTER TABLE ONLY subscription_plans
    ADD CONSTRAINT subscription_plans_tenant_app_store_product_id_key UNIQUE (tenant_id, app_store_product_id);

-- CONSTRAINT: subscription_plans subscription_plans_tenant_google_play_product_id_key
ALTER TABLE ONLY subscription_plans
    ADD CONSTRAINT subscription_plans_tenant_google_play_product_id_key UNIQUE (tenant_id, google_play_product_id);

-- COLUMN: subscriptions provider
-- Who bills the subscription: Stripe, or the store the app bought it through.
-- The default is what lets the previous release's insert, which names no
-- provider, go on recording a Stripe subscription, and it is also what every
-- row already here reads as; it is dropped in the release after this one.
ALTER TABLE subscriptions
    ADD COLUMN provider text DEFAULT 'stripe'::text NOT NULL;

-- COLUMN: subscriptions store_subscription_id
-- The store's own ID of the subscription, which stays the same across its
-- renewals: the App Store's originalTransactionId, or Google Play's purchase
-- token. NULL for a Stripe subscription. Its uniqueness per tenant and store is
-- enforced by an index built concurrently in the next migration.
ALTER TABLE subscriptions
    ADD COLUMN store_subscription_id text;

-- COLUMN: subscriptions store_product_id
-- The store product the subscription bills, as the store last reported it.
-- NULL for a Stripe subscription, which names its Price instead.
ALTER TABLE subscriptions
    ADD COLUMN store_product_id text;

-- COLUMN: subscriptions is_test
-- A subscription from the App Store sandbox or a Google Play license tester,
-- as purchases.is_test is: it opens the plan's episodes, since App Review
-- subscribes that way against the production build, but no money reached the
-- tenant.
ALTER TABLE subscriptions
    ADD COLUMN is_test boolean DEFAULT false NOT NULL;

-- A store subscription carries none of Stripe's ids.
ALTER TABLE subscriptions
    ALTER COLUMN stripe_customer_id DROP NOT NULL,
    ALTER COLUMN stripe_subscription_id DROP NOT NULL,
    ALTER COLUMN stripe_price_id DROP NOT NULL;

-- CONSTRAINT: subscriptions subscriptions_provider_check
-- A Stripe subscription names Stripe's customer, subscription, and Price and
-- nothing of a store's; a store subscription names its store's subscription
-- and product and nothing of Stripe's; and only a store subscription can be a
-- test one. NOT VALID here, and validated by a later migration under a lock
-- that lets reads and writes go on, since every row already here is a Stripe
-- one that satisfies it.
ALTER TABLE ONLY subscriptions
    ADD CONSTRAINT subscriptions_provider_check CHECK (((provider = ANY (ARRAY['stripe'::text, 'app_store'::text, 'google_play'::text])) AND ((provider = 'stripe'::text) = (stripe_customer_id IS NOT NULL)) AND ((provider = 'stripe'::text) = (stripe_subscription_id IS NOT NULL)) AND ((provider = 'stripe'::text) = (stripe_price_id IS NOT NULL)) AND ((provider = 'stripe'::text) = (store_subscription_id IS NULL)) AND ((provider = 'stripe'::text) = (store_product_id IS NULL)) AND ((NOT is_test) OR (provider <> 'stripe'::text)))) NOT VALID;

-- CONSTRAINT: subscriptions subscriptions_store_subscription_id_check
-- NOT VALID and validated later for the same reason.
ALTER TABLE ONLY subscriptions
    ADD CONSTRAINT subscriptions_store_subscription_id_check CHECK (((char_length(store_subscription_id) >= 1) AND (char_length(store_product_id) >= 1))) NOT VALID;

-- VIEW: billed_subscriptions
-- The Stripe subscriptions Stripe goes on billing, which closing the account
-- cancels: a store bills a subscription of its own, and only the reader can
-- cancel it there. The previous release reads this view as the subscriptions a
-- reader may not start a second checkout beside, too, and goes on answering
-- that from the Stripe ones alone; this release asks live_subscriptions.
CREATE OR REPLACE VIEW billed_subscriptions WITH (security_invoker = true) AS
SELECT s.*
FROM subscriptions s
WHERE s.provider = 'stripe'
    AND s.status IN ('trialing', 'active', 'past_due', 'unpaid', 'paused');

-- VIEW: live_subscriptions
-- The subscriptions someone goes on billing, whoever bills them: the ones a
-- reader may not start a second subscription beside, through Stripe or a
-- store. An incomplete one is not among them, since it bills nothing unless
-- its first payment goes through.
CREATE VIEW live_subscriptions WITH (security_invoker = true) AS
SELECT s.*
FROM subscriptions s
WHERE s.status IN ('trialing', 'active', 'past_due', 'unpaid', 'paused');

-- TABLE: store_subscription_intents
-- What the reader asked to subscribe to before the store's payment sheet
-- opened, as store_purchase_intents is for an episode. The app hands the
-- intent ID to the store as the transaction's account token, so the server,
-- not the app, says whose subscription a verified transaction is.
CREATE TABLE store_subscription_intents (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    plan_id uuid NOT NULL,
    -- The store product the plan was sold as when the intent was opened; a
    -- transaction for another product does not consume this intent.
    product_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    -- Set when the first verified transaction of a subscription consumed the
    -- intent, which no other subscription can consume again.
    consumed_at timestamp with time zone,
    CONSTRAINT store_subscription_intents_product_id_check CHECK ((char_length(product_id) > 0))
);

-- CONSTRAINT: store_subscription_intents store_subscription_intents_pkey
ALTER TABLE ONLY store_subscription_intents
    ADD CONSTRAINT store_subscription_intents_pkey PRIMARY KEY (id);

-- INDEX: idx_store_subscription_intents_open
-- One open intent per reader, plan, and product: asking again reuses it, so a
-- reader pressing Subscribe repeatedly adds no rows.
CREATE UNIQUE INDEX idx_store_subscription_intents_open ON store_subscription_intents USING btree (tenant_id, user_id, plan_id, product_id) WHERE (consumed_at IS NULL);

-- INDEX: idx_store_subscription_intents_tenant_plan_id
-- Backs the composite foreign key to subscription_plans.
CREATE INDEX idx_store_subscription_intents_tenant_plan_id ON store_subscription_intents USING btree (tenant_id, plan_id);

-- FK CONSTRAINT: store_subscription_intents store_subscription_intents_tenant_id_fkey
ALTER TABLE ONLY store_subscription_intents
    ADD CONSTRAINT store_subscription_intents_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: store_subscription_intents store_subscription_intents_tenant_user_id_fkey
ALTER TABLE ONLY store_subscription_intents
    ADD CONSTRAINT store_subscription_intents_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: store_subscription_intents store_subscription_intents_tenant_plan_id_fkey
-- An intent the reader may still be paying in the store names its plan, so the
-- plan is not deleted out from under it, as one a checkout names is not. NO
-- ACTION rather than RESTRICT, so a tenant deleted as a whole takes both rows
-- in the one statement.
ALTER TABLE ONLY store_subscription_intents
    ADD CONSTRAINT store_subscription_intents_tenant_plan_id_fkey FOREIGN KEY (tenant_id, plan_id) REFERENCES subscription_plans(tenant_id, id);

-- ROW SECURITY: store_subscription_intents
ALTER TABLE store_subscription_intents ENABLE ROW LEVEL SECURITY;

-- POLICY: store_subscription_intents store_subscription_intents_tenant_isolation
CREATE POLICY store_subscription_intents_tenant_isolation ON store_subscription_intents USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));
