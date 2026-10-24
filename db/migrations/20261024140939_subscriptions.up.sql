-- Subscription plans: a recurring Stripe Price a tenant sells, and what it
-- opens while it is paid. A reader subscribes through a Stripe Checkout
-- Session in subscription mode, and the subscription's state follows Stripe's
-- webhooks from then on.

-- TABLE: subscription_plans
-- stripe_price_id names the recurring Price on the tenant's Stripe account.
-- A Price's amount and interval never change in Stripe, so the ones it had
-- when the plan was saved are kept beside it for the plan page: price_amount
-- in the minor unit of currency, billed every recurring_interval_count
-- recurring_intervals.
--
-- scope says what the plan opens: every episode of the tenant (`all`), the
-- series of the labels its targets name (`label`), or the series its targets
-- name (`series`). The admin API caps how many plans one tenant holds, which
-- is what lets every list of them go unpaged.
CREATE TABLE subscription_plans (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    public_id character varying(12) NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    stripe_price_id text NOT NULL,
    price_amount integer NOT NULL,
    currency text NOT NULL,
    recurring_interval text NOT NULL,
    recurring_interval_count integer NOT NULL,
    scope text NOT NULL,
    is_published boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT subscription_plans_name_check CHECK ((char_length(name) >= 1)),
    CONSTRAINT subscription_plans_stripe_price_id_check CHECK ((char_length(stripe_price_id) >= 1)),
    CONSTRAINT subscription_plans_price_amount_check CHECK ((price_amount >= 0)),
    CONSTRAINT subscription_plans_currency_check CHECK ((currency ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT subscription_plans_recurring_interval_check CHECK ((recurring_interval = ANY (ARRAY['day'::text, 'week'::text, 'month'::text, 'year'::text]))),
    CONSTRAINT subscription_plans_recurring_interval_count_check CHECK ((recurring_interval_count >= 1)),
    CONSTRAINT subscription_plans_scope_check CHECK ((scope = ANY (ARRAY['all'::text, 'label'::text, 'series'::text])))
);

-- CONSTRAINT: subscription_plans subscription_plans_pkey
ALTER TABLE ONLY subscription_plans
    ADD CONSTRAINT subscription_plans_pkey PRIMARY KEY (id);

-- CONSTRAINT: subscription_plans subscription_plans_tenant_id_id_key
-- Lets the targets and the subscriptions name the plan together with its
-- tenant.
ALTER TABLE ONLY subscription_plans
    ADD CONSTRAINT subscription_plans_tenant_id_id_key UNIQUE (tenant_id, id);

-- CONSTRAINT: subscription_plans subscription_plans_tenant_public_id_key
ALTER TABLE ONLY subscription_plans
    ADD CONSTRAINT subscription_plans_tenant_public_id_key UNIQUE (tenant_id, public_id);

-- CONSTRAINT: subscription_plans subscription_plans_tenant_stripe_price_id_key
-- A Price is what a subscription is billed at, so it names one plan: a
-- subscription whose Price the reader changed in Stripe's billing portal is
-- recorded on the plan of its new Price.
ALTER TABLE ONLY subscription_plans
    ADD CONSTRAINT subscription_plans_tenant_stripe_price_id_key UNIQUE (tenant_id, stripe_price_id);

-- FK CONSTRAINT: subscription_plans subscription_plans_tenant_id_fkey
ALTER TABLE ONLY subscription_plans
    ADD CONSTRAINT subscription_plans_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- INDEX: idx_subscription_plans_tenant_created_at
-- Every list of a tenant's plans, the console's and the storefront's, is in
-- the order they were created.
CREATE INDEX idx_subscription_plans_tenant_created_at ON subscription_plans USING btree (tenant_id, created_at, id);

-- ROW SECURITY: subscription_plans
ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;

-- POLICY: subscription_plans subscription_plans_tenant_isolation
CREATE POLICY subscription_plans_tenant_isolation ON subscription_plans USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: subscription_plan_targets
-- The labels a `label` plan opens, or the series a `series` plan opens: each
-- row names exactly one of the two. An `all` plan has none. Which kind a plan
-- may hold follows its scope, which the admin API keeps.
CREATE TABLE subscription_plan_targets (
    tenant_id uuid NOT NULL,
    plan_id uuid NOT NULL,
    label_id uuid,
    series_id uuid,
    CONSTRAINT subscription_plan_targets_target_check CHECK ((num_nonnulls(label_id, series_id) = 1))
);

-- CONSTRAINT: subscription_plan_targets subscription_plan_targets_label_key
-- A NULL label_id is distinct from every other, so the series rows of a plan
-- never collide here, and the same holds for the label rows below.
ALTER TABLE ONLY subscription_plan_targets
    ADD CONSTRAINT subscription_plan_targets_label_key UNIQUE (tenant_id, plan_id, label_id);

-- CONSTRAINT: subscription_plan_targets subscription_plan_targets_series_key
ALTER TABLE ONLY subscription_plan_targets
    ADD CONSTRAINT subscription_plan_targets_series_key UNIQUE (tenant_id, plan_id, series_id);

-- FK CONSTRAINT: subscription_plan_targets subscription_plan_targets_tenant_id_fkey
ALTER TABLE ONLY subscription_plan_targets
    ADD CONSTRAINT subscription_plan_targets_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: subscription_plan_targets subscription_plan_targets_tenant_plan_id_fkey
ALTER TABLE ONLY subscription_plan_targets
    ADD CONSTRAINT subscription_plan_targets_tenant_plan_id_fkey FOREIGN KEY (tenant_id, plan_id) REFERENCES subscription_plans(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: subscription_plan_targets subscription_plan_targets_tenant_label_id_fkey
-- A deleted label or series leaves the plans that named it, which go on
-- opening whatever else they name.
ALTER TABLE ONLY subscription_plan_targets
    ADD CONSTRAINT subscription_plan_targets_tenant_label_id_fkey FOREIGN KEY (tenant_id, label_id) REFERENCES labels(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: subscription_plan_targets subscription_plan_targets_tenant_series_id_fkey
ALTER TABLE ONLY subscription_plan_targets
    ADD CONSTRAINT subscription_plan_targets_tenant_series_id_fkey FOREIGN KEY (tenant_id, series_id) REFERENCES series(tenant_id, id) ON DELETE CASCADE;

-- INDEX: idx_subscription_plan_targets_tenant_label_id
-- Backs the composite foreign key to labels.
CREATE INDEX idx_subscription_plan_targets_tenant_label_id ON subscription_plan_targets USING btree (tenant_id, label_id)
    WHERE (label_id IS NOT NULL);

-- INDEX: idx_subscription_plan_targets_tenant_series_id
-- Backs the composite foreign key to series.
CREATE INDEX idx_subscription_plan_targets_tenant_series_id ON subscription_plan_targets USING btree (tenant_id, series_id)
    WHERE (series_id IS NOT NULL);

-- ROW SECURITY: subscription_plan_targets
ALTER TABLE subscription_plan_targets ENABLE ROW LEVEL SECURITY;

-- POLICY: subscription_plan_targets subscription_plan_targets_tenant_isolation
CREATE POLICY subscription_plan_targets_tenant_isolation ON subscription_plan_targets USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: subscriptions
-- One Stripe subscription of one reader, as Stripe last reported it. status
-- is Stripe's own value, and current_period_end the end of the period paid
-- for, which is where a subscription set to cancel_at_period_end stops.
--
-- Stripe is the record: every webhook about a subscription writes what
-- Stripe answers for it at that moment, so a notification that arrives late
-- or twice writes nothing older than what is already here.
CREATE TABLE subscriptions (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid,
    plan_id uuid NOT NULL,
    stripe_customer_id text NOT NULL,
    stripe_subscription_id text NOT NULL,
    status text NOT NULL,
    current_period_end timestamp with time zone,
    cancel_at_period_end boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT subscriptions_status_check CHECK ((status = ANY (ARRAY['incomplete'::text, 'incomplete_expired'::text, 'trialing'::text, 'active'::text, 'past_due'::text, 'canceled'::text, 'unpaid'::text, 'paused'::text]))),
    CONSTRAINT subscriptions_stripe_customer_id_check CHECK ((char_length(stripe_customer_id) >= 1)),
    CONSTRAINT subscriptions_stripe_subscription_id_check CHECK ((char_length(stripe_subscription_id) >= 1))
);

-- CONSTRAINT: subscriptions subscriptions_pkey
ALTER TABLE ONLY subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);

-- CONSTRAINT: subscriptions subscriptions_tenant_stripe_subscription_id_key
-- A redelivered notification updates the row its subscription already has.
ALTER TABLE ONLY subscriptions
    ADD CONSTRAINT subscriptions_tenant_stripe_subscription_id_key UNIQUE (tenant_id, stripe_subscription_id);

-- FK CONSTRAINT: subscriptions subscriptions_tenant_id_fkey
ALTER TABLE ONLY subscriptions
    ADD CONSTRAINT subscriptions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: subscriptions subscriptions_tenant_user_id_fkey
-- A subscription someone paid for outlives its subscriber's account, as a
-- purchase does.
ALTER TABLE ONLY subscriptions
    ADD CONSTRAINT subscriptions_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE SET NULL (user_id);

-- FK CONSTRAINT: subscriptions subscriptions_tenant_plan_id_fkey
-- A plan anyone has subscribed to is not deleted out from under them. NO
-- ACTION rather than RESTRICT, so a tenant deleted as a whole takes both rows
-- in the one statement.
ALTER TABLE ONLY subscriptions
    ADD CONSTRAINT subscriptions_tenant_plan_id_fkey FOREIGN KEY (tenant_id, plan_id) REFERENCES subscription_plans(tenant_id, id);

-- INDEX: idx_subscriptions_tenant_user_updated_at
-- The reader's own subscriptions, latest first, and the composite foreign key
-- to users.
CREATE INDEX idx_subscriptions_tenant_user_updated_at ON subscriptions USING btree (tenant_id, user_id, updated_at DESC);

-- INDEX: idx_subscriptions_tenant_plan_status
-- A plan's subscriber count, and the composite foreign key to it.
CREATE INDEX idx_subscriptions_tenant_plan_status ON subscriptions USING btree (tenant_id, plan_id, status);

-- ROW SECURITY: subscriptions
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- POLICY: subscriptions subscriptions_tenant_isolation
CREATE POLICY subscriptions_tenant_isolation ON subscriptions USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: subscription_checkouts
-- The latest subscription checkout each reader started, so the next one can
-- find it: reuse it while it is open on the same plan, expire it before
-- starting one on another, and refuse a new one while it has completed and
-- its subscription is still on its way. Without it a reader could hold two
-- open checkouts at once and pay both, and be billed twice.
CREATE TABLE subscription_checkouts (
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    plan_id uuid NOT NULL,
    stripe_checkout_session_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT subscription_checkouts_stripe_checkout_session_id_check CHECK ((char_length(stripe_checkout_session_id) >= 1))
);

-- CONSTRAINT: subscription_checkouts subscription_checkouts_pkey
ALTER TABLE ONLY subscription_checkouts
    ADD CONSTRAINT subscription_checkouts_pkey PRIMARY KEY (tenant_id, user_id);

-- FK CONSTRAINT: subscription_checkouts subscription_checkouts_tenant_id_fkey
ALTER TABLE ONLY subscription_checkouts
    ADD CONSTRAINT subscription_checkouts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: subscription_checkouts subscription_checkouts_tenant_user_id_fkey
ALTER TABLE ONLY subscription_checkouts
    ADD CONSTRAINT subscription_checkouts_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: subscription_checkouts subscription_checkouts_tenant_plan_id_fkey
-- A checkout a reader may still pay names its plan, so the plan is not
-- deleted out from under it, as one a subscription names is not. NO ACTION
-- rather than RESTRICT, so a tenant deleted as a whole takes both rows in the
-- one statement.
ALTER TABLE ONLY subscription_checkouts
    ADD CONSTRAINT subscription_checkouts_tenant_plan_id_fkey FOREIGN KEY (tenant_id, plan_id) REFERENCES subscription_plans(tenant_id, id);

-- INDEX: idx_subscription_checkouts_tenant_plan_id
-- Backs the composite foreign key to subscription_plans.
CREATE INDEX idx_subscription_checkouts_tenant_plan_id ON subscription_checkouts USING btree (tenant_id, plan_id);

-- ROW SECURITY: subscription_checkouts
ALTER TABLE subscription_checkouts ENABLE ROW LEVEL SECURITY;

-- POLICY: subscription_checkouts subscription_checkouts_tenant_isolation
CREATE POLICY subscription_checkouts_tenant_isolation ON subscription_checkouts USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));
