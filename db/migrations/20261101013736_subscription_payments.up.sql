-- Subscription payments: each invoice Stripe takes a plan's payment for,
-- counted in the tenant's revenue on the day it was paid and shared on a
-- royalty statement among the Authors of the episodes the subscriber finished
-- in the period it paid for.
--
-- Every statement here creates something new or adds a nullable column, so no
-- row of an existing table is rewritten, and the CHECK constraint on the
-- statement lines is added NOT VALID and validated by the next migration.

-- CONSTRAINT: subscriptions subscriptions_tenant_id_id_key
-- The index the previous migration built concurrently, attached as the target
-- of a reference that names a subscription with its tenant. Attaching an index
-- that already exists is a change to the catalog only, so the lock this takes
-- is brief.
ALTER TABLE ONLY subscriptions
    ADD CONSTRAINT subscriptions_tenant_id_id_key UNIQUE USING INDEX subscriptions_tenant_id_id_key;

-- TABLE: subscription_payments
-- One invoice of a Stripe subscription that Stripe reports paid. amount is
-- what the reader paid, in the minor unit of currency, and period_start and
-- period_end the half-open period of the plan it paid for. plan_id is the plan
-- the subscription was recorded on when the payment was, which is the plan
-- whose episodes the payment is shared among.
--
-- refunded_amount is the total Stripe reports refunded on the payment, NULL
-- while nothing ever was, as purchases.refunded_amount is. A payment refunded
-- up to its amount is refunded in full.
--
-- stripe_payment_intent_id is the PaymentIntent the invoice was paid through,
-- which is what a refund notification names. NULL for an invoice marked paid
-- outside Stripe, which no refund through Stripe can reach.
--
-- is_test is a payment made in Stripe's test mode, which paid the tenant
-- nothing, so the revenue figures and the statements leave it out.
CREATE TABLE subscription_payments (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    subscription_id uuid NOT NULL,
    plan_id uuid NOT NULL,
    stripe_invoice_id text NOT NULL,
    stripe_payment_intent_id text,
    amount integer NOT NULL,
    currency text NOT NULL,
    period_start timestamp with time zone NOT NULL,
    period_end timestamp with time zone NOT NULL,
    paid_at timestamp with time zone NOT NULL,
    refunded_amount integer,
    is_test boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT subscription_payments_stripe_invoice_id_check CHECK ((char_length(stripe_invoice_id) >= 1)),
    CONSTRAINT subscription_payments_stripe_payment_intent_id_check CHECK ((char_length(stripe_payment_intent_id) >= 1)),
    CONSTRAINT subscription_payments_amount_check CHECK ((amount > 0)),
    CONSTRAINT subscription_payments_currency_check CHECK ((currency ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT subscription_payments_period_check CHECK ((period_start < period_end)),
    CONSTRAINT subscription_payments_refunded_amount_check CHECK (((refunded_amount >= 0) AND (refunded_amount <= amount)))
);

-- CONSTRAINT: subscription_payments subscription_payments_pkey
ALTER TABLE ONLY subscription_payments
    ADD CONSTRAINT subscription_payments_pkey PRIMARY KEY (id);

-- CONSTRAINT: subscription_payments subscription_payments_tenant_id_id_key
-- The target of the statements' references to a payment, which name it with
-- its tenant.
ALTER TABLE ONLY subscription_payments
    ADD CONSTRAINT subscription_payments_tenant_id_id_key UNIQUE (tenant_id, id);

-- CONSTRAINT: subscription_payments subscription_payments_tenant_stripe_invoice_id_key
-- A redelivered notification of the same invoice records nothing twice.
ALTER TABLE ONLY subscription_payments
    ADD CONSTRAINT subscription_payments_tenant_stripe_invoice_id_key UNIQUE (tenant_id, stripe_invoice_id);

-- FK CONSTRAINT: subscription_payments subscription_payments_tenant_id_fkey
ALTER TABLE ONLY subscription_payments
    ADD CONSTRAINT subscription_payments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: subscription_payments subscription_payments_tenant_subscription_id_fkey
-- Nothing deletes a subscription but its tenant. NO ACTION rather than
-- RESTRICT, so a tenant deleted as a whole takes both rows in the one
-- statement.
ALTER TABLE ONLY subscription_payments
    ADD CONSTRAINT subscription_payments_tenant_subscription_id_fkey FOREIGN KEY (tenant_id, subscription_id) REFERENCES subscriptions(tenant_id, id);

-- FK CONSTRAINT: subscription_payments subscription_payments_tenant_plan_id_fkey
-- A plan someone paid for is not deleted out from under the payment, as one a
-- subscription names is not.
ALTER TABLE ONLY subscription_payments
    ADD CONSTRAINT subscription_payments_tenant_plan_id_fkey FOREIGN KEY (tenant_id, plan_id) REFERENCES subscription_plans(tenant_id, id);

-- INDEX: idx_subscription_payments_tenant_payment_intent
-- What a refund notification finds its payment by.
CREATE UNIQUE INDEX idx_subscription_payments_tenant_payment_intent ON subscription_payments USING btree (tenant_id, stripe_payment_intent_id)
    WHERE (stripe_payment_intent_id IS NOT NULL);

-- INDEX: idx_subscription_payments_tenant_paid_at
-- The payments of a period of the tenant's days, which the revenue figures
-- count.
CREATE INDEX idx_subscription_payments_tenant_paid_at ON subscription_payments USING btree (tenant_id, paid_at);

-- INDEX: idx_subscription_payments_tenant_period_end
-- The payments whose period ends in a month, which its statement shares.
CREATE INDEX idx_subscription_payments_tenant_period_end ON subscription_payments USING btree (tenant_id, period_end);

-- INDEX: idx_subscription_payments_tenant_subscription_id
-- Backs the composite foreign key to subscriptions.
CREATE INDEX idx_subscription_payments_tenant_subscription_id ON subscription_payments USING btree (tenant_id, subscription_id);

-- INDEX: idx_subscription_payments_tenant_plan_id
-- Backs the composite foreign key to subscription_plans.
CREATE INDEX idx_subscription_payments_tenant_plan_id ON subscription_payments USING btree (tenant_id, plan_id);

-- ROW SECURITY: subscription_payments
ALTER TABLE subscription_payments ENABLE ROW LEVEL SECURITY;

-- POLICY: subscription_payments subscription_payments_tenant_isolation
CREATE POLICY subscription_payments_tenant_isolation ON subscription_payments USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- VIEW: subscription_plan_episodes
-- Every episode in a plan's scope: the whole tenant, the series of the labels
-- the plan names, or the series it names, read as episode_grants reads them,
-- so a target that does not match its plan's scope names nothing.
CREATE VIEW subscription_plan_episodes WITH (security_invoker = true) AS
SELECT sp.tenant_id,
    sp.id AS plan_id,
    e.id AS episode_id
FROM subscription_plans sp
    JOIN episodes e ON e.tenant_id = sp.tenant_id
    JOIN series sr ON sr.tenant_id = e.tenant_id
    AND sr.id = e.series_id
WHERE sp.scope = 'all'
    OR EXISTS (
        SELECT 1
        FROM subscription_plan_targets t
        WHERE t.tenant_id = sp.tenant_id
            AND t.plan_id = sp.id
            AND (
                (
                    sp.scope = 'series'
                    AND t.series_id = e.series_id
                )
                OR (
                    sp.scope = 'label'
                    AND t.label_id = sr.label_id
                )
            )
    );

-- VIEW: subscription_payment_completions
-- The episodes of a payment's plan its subscriber finished in the period the
-- payment paid for, from the episode_complete events. A member has one such
-- event per episode, the projection of their first completed read of it, so an
-- episode finished again in a later period counts in none. An account deleted
-- since takes its events with it, and its payments have no completion.
CREATE VIEW subscription_payment_completions WITH (security_invoker = true) AS
SELECT sp.tenant_id,
    sp.id AS subscription_payment_id,
    ce.episode_id
FROM subscription_payments sp
    JOIN subscriptions s ON s.tenant_id = sp.tenant_id
    AND s.id = sp.subscription_id
    JOIN content_events ce ON ce.tenant_id = sp.tenant_id
    AND ce.user_id = s.user_id
    AND ce.event_type = 'episode_complete'
    AND ce.occurred_at >= sp.period_start
    AND ce.occurred_at < sp.period_end
    JOIN subscription_plan_episodes pe ON pe.tenant_id = sp.tenant_id
    AND pe.plan_id = sp.plan_id
    AND pe.episode_id = ce.episode_id;

-- VIEW: subscription_payment_episode_parts
-- The part of a payment's amount each episode of
-- subscription_payment_completions accounts for: the amount spread evenly over
-- them, each part what the running count of the episodes up to and including
-- it comes to of the amount less what the count before it came to, each
-- rounded down, so that the parts add up to the amount exactly, as a series
-- bundle's do. An episode a small amount leaves nothing to is no part of the
-- payment. A payment with no completion has no part, and is shared with no
-- one.
--
-- The parts move while the period's completions come in, so a statement
-- reads them when it is closed and writes them down in
-- royalty_statement_subscription_parts, which is what a later refund is
-- divided by.
--
-- The divisor is never zero for a completion of the payment, but the planner
-- may work out a part for a payment before it has matched the completion it
-- belongs to, which for a payment with none would divide by a count of zero.
CREATE VIEW subscription_payment_episode_parts WITH (security_invoker = true) AS
SELECT c.tenant_id,
    c.subscription_payment_id,
    sp.period_end,
    c.episode_id,
    part.price
FROM subscription_payment_completions c
    JOIN subscription_payments sp ON sp.tenant_id = c.tenant_id
    AND sp.id = c.subscription_payment_id
    CROSS JOIN LATERAL (
        SELECT count(*) FILTER (WHERE o.episode_id <= c.episode_id)::bigint AS up_to,
            count(*)::bigint AS total
        FROM subscription_payment_completions o
        WHERE o.tenant_id = c.tenant_id
            AND o.subscription_payment_id = c.subscription_payment_id
    ) running
    CROSS JOIN LATERAL (
        SELECT (sp.amount::bigint * running.up_to / NULLIF(running.total, 0)
            - sp.amount::bigint * (running.up_to - 1) / NULLIF(running.total, 0))::integer AS price
    ) part
WHERE part.price > 0;

-- COLUMN: royalty_statement_lines source
-- What a line credits: `sale`, the sales of an episode, or `subscription`, the
-- parts of subscription payments shared to it. An adjustment line has the
-- source of the line it adjusts. NULL is a line the release before this one
-- closed, which knew sales alone, and reads as `sale`.
ALTER TABLE ONLY royalty_statement_lines
    ADD COLUMN source text;

-- CONSTRAINT: royalty_statement_lines royalty_statement_lines_source_check
-- NOT VALID here, and validated by the next migration under a lock that lets
-- reads and writes go on, since every row already here is NULL.
ALTER TABLE ONLY royalty_statement_lines
    ADD CONSTRAINT royalty_statement_lines_source_check CHECK ((source = ANY (ARRAY['sale'::text, 'subscription'::text]))) NOT VALID;

-- TABLE: royalty_statement_subscription_payments
-- What one statement counted of one subscription payment, as
-- royalty_statement_purchases is for a purchase: the month the payment's
-- period ends in counts it as a sale, sale_count 1, its amount, and the part
-- refunded by then, when it shared it with anyone; a statement closed later
-- that carries a refund of it counts the change, 0 and the refund's growth
-- while it is not refunded in full, -1 and the negation of what was counted
-- before once it is. A payment shared with no one has no row, and its refund
-- takes back nothing from anyone.
CREATE TABLE royalty_statement_subscription_payments (
    tenant_id uuid NOT NULL,
    -- No foreign key, as royalty_statement_purchases has none: the row is
    -- part of a closed statement and keeps the ID it counted.
    subscription_payment_id uuid NOT NULL,
    statement_id uuid NOT NULL,
    sale_count integer NOT NULL,
    gross_amount integer NOT NULL,
    refunded_amount integer NOT NULL,
    CONSTRAINT royalty_statement_subscription_payments_sale_count_check CHECK (((sale_count >= '-1'::integer) AND (sale_count <= 1)))
);

-- CONSTRAINT: royalty_statement_subscription_payments royalty_statement_subscription_payments_pkey
-- Led by the payment, which is how a close looks up what came before it.
ALTER TABLE ONLY royalty_statement_subscription_payments
    ADD CONSTRAINT royalty_statement_subscription_payments_pkey PRIMARY KEY (tenant_id, subscription_payment_id, statement_id);

-- INDEX: idx_royalty_statement_subscription_payments_statement_id
-- Serves the cascade from a deleted statement, which goes with its tenant.
CREATE INDEX idx_royalty_statement_subscription_payments_statement_id ON royalty_statement_subscription_payments USING btree (statement_id);

-- FK CONSTRAINT: royalty_statement_subscription_payments royalty_statement_subscription_payments_tenant_statement_id_fkey
ALTER TABLE ONLY royalty_statement_subscription_payments
    ADD CONSTRAINT royalty_statement_subscription_payments_tenant_statement_id_fkey FOREIGN KEY (tenant_id, statement_id) REFERENCES royalty_statements(tenant_id, id) ON DELETE CASCADE;

-- ROW SECURITY: royalty_statement_subscription_payments
ALTER TABLE royalty_statement_subscription_payments ENABLE ROW LEVEL SECURITY;

-- POLICY: royalty_statement_subscription_payments royalty_statement_subscription_payments_tenant_isolation
CREATE POLICY royalty_statement_subscription_payments_tenant_isolation ON royalty_statement_subscription_payments USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TRIGGER: royalty_statement_subscription_payments royalty_statement_subscription_payments_immutable
-- Part of the statement it was written with, and as unchangeable.
CREATE TRIGGER royalty_statement_subscription_payments_immutable
    BEFORE UPDATE OR DELETE ON royalty_statement_subscription_payments
    FOR EACH ROW
    EXECUTE FUNCTION royalty_statements_refuse_changes();

-- TABLE: royalty_statement_subscription_parts
-- The parts of a subscription payment the statement that counted it as a sale
-- credited, as subscription_payment_episode_parts answered them at its close.
-- Only one statement counts a payment as a sale, so a payment and an episode
-- have one row. A refund recorded after that close is divided over these
-- parts, so it takes back from each episode what the statement paid on it.
CREATE TABLE royalty_statement_subscription_parts (
    tenant_id uuid NOT NULL,
    statement_id uuid NOT NULL,
    subscription_payment_id uuid NOT NULL,
    -- No foreign key: a statement line keeps the ID of an episode deleted
    -- since, and so does the part it was credited by.
    episode_id uuid NOT NULL,
    price integer NOT NULL,
    CONSTRAINT royalty_statement_subscription_parts_price_check CHECK ((price > 0))
);

-- CONSTRAINT: royalty_statement_subscription_parts royalty_statement_subscription_parts_pkey
ALTER TABLE ONLY royalty_statement_subscription_parts
    ADD CONSTRAINT royalty_statement_subscription_parts_pkey PRIMARY KEY (tenant_id, subscription_payment_id, episode_id);

-- INDEX: idx_royalty_statement_subscription_parts_statement_id
-- Serves the cascade from a deleted statement, which goes with its tenant.
CREATE INDEX idx_royalty_statement_subscription_parts_statement_id ON royalty_statement_subscription_parts USING btree (statement_id);

-- FK CONSTRAINT: royalty_statement_subscription_parts royalty_statement_subscription_parts_tenant_statement_id_fkey
ALTER TABLE ONLY royalty_statement_subscription_parts
    ADD CONSTRAINT royalty_statement_subscription_parts_tenant_statement_id_fkey FOREIGN KEY (tenant_id, statement_id) REFERENCES royalty_statements(tenant_id, id) ON DELETE CASCADE;

-- ROW SECURITY: royalty_statement_subscription_parts
ALTER TABLE royalty_statement_subscription_parts ENABLE ROW LEVEL SECURITY;

-- POLICY: royalty_statement_subscription_parts royalty_statement_subscription_parts_tenant_isolation
CREATE POLICY royalty_statement_subscription_parts_tenant_isolation ON royalty_statement_subscription_parts USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TRIGGER: royalty_statement_subscription_parts royalty_statement_subscription_parts_immutable
CREATE TRIGGER royalty_statement_subscription_parts_immutable
    BEFORE UPDATE OR DELETE ON royalty_statement_subscription_parts
    FOR EACH ROW
    EXECUTE FUNCTION royalty_statements_refuse_changes();

-- VIEW: royalty_uncarried_subscription_refunds
-- Each subscription payment a statement shared whose net, its amount less its
-- refund, has fallen since, with the change still to be carried and the
-- statement that shared it, as royalty_uncarried_refunds is for a purchase. A
-- payment counts as a sale while it is not refunded in full. A close carries
-- the rows of statements of earlier months than its own, and a preview shows
-- the same rows, so the two cannot disagree.
--
-- Only a payment with a refund on it can have a row, which is what keeps a
-- close from summing every payment the tenant was ever paid.
CREATE VIEW royalty_uncarried_subscription_refunds WITH (security_invoker = true) AS
SELECT sp.tenant_id,
    sp.id AS subscription_payment_id,
    sp.currency,
    rs.id AS statement_id,
    rs.period,
    (cur.sale_count - counted.sale_count)::integer AS sale_count,
    (cur.gross_amount - counted.gross_amount)::bigint AS gross_amount,
    (cur.refunded_amount - counted.refunded_amount)::bigint AS refunded_amount,
    counted.refunded_amount::bigint AS counted_refunded_amount
FROM subscription_payments sp
    JOIN royalty_statement_subscription_payments sale ON sale.tenant_id = sp.tenant_id
    AND sale.subscription_payment_id = sp.id
    AND sale.sale_count = 1
    JOIN royalty_statements rs ON rs.tenant_id = sale.tenant_id
    AND rs.id = sale.statement_id
    CROSS JOIN LATERAL (
        SELECT sum(rssp.sale_count) AS sale_count,
            sum(rssp.gross_amount) AS gross_amount,
            sum(rssp.refunded_amount) AS refunded_amount
        FROM royalty_statement_subscription_payments rssp
        WHERE rssp.tenant_id = sp.tenant_id
            AND rssp.subscription_payment_id = sp.id
    ) counted
    CROSS JOIN LATERAL (
        SELECT CASE WHEN sp.refunded_amount < sp.amount THEN 1 ELSE 0 END AS sale_count,
            CASE WHEN sp.refunded_amount < sp.amount THEN sp.amount ELSE 0 END AS gross_amount,
            CASE WHEN sp.refunded_amount < sp.amount THEN sp.refunded_amount ELSE 0 END AS refunded_amount
    ) cur
WHERE sp.refunded_amount IS NOT NULL
    AND cur.gross_amount - cur.refunded_amount < counted.gross_amount - counted.refunded_amount;

-- VIEW: royalty_uncarried_subscription_episode_refunds
-- royalty_uncarried_subscription_refunds spread over the parts the statement
-- that shared each payment credited, as royalty_uncarried_episode_refunds
-- spreads a purchase's: each part's change of refund is its part of the refund
-- now less its part of the refund the statements have counted, each divided
-- by episode_part_of_purchase_amount, which is how the month's own lines
-- divided it.
CREATE VIEW royalty_uncarried_subscription_episode_refunds WITH (security_invoker = true) AS
SELECT u.tenant_id,
    u.subscription_payment_id,
    pt.episode_id,
    u.currency,
    u.statement_id,
    u.period,
    u.sale_count,
    part.gross_amount,
    part.refunded_amount
FROM royalty_uncarried_subscription_refunds u
    JOIN subscription_payments sp ON sp.tenant_id = u.tenant_id
    AND sp.id = u.subscription_payment_id
    JOIN royalty_statement_subscription_parts pt ON pt.tenant_id = u.tenant_id
    AND pt.subscription_payment_id = u.subscription_payment_id
    CROSS JOIN LATERAL (
        SELECT (u.sale_count * pt.price)::bigint AS gross_amount,
            (
                episode_part_of_purchase_amount(u.counted_refunded_amount + u.refunded_amount, pt.price, sp.amount)
                - episode_part_of_purchase_amount(u.counted_refunded_amount, pt.price, sp.amount)
            )::bigint AS refunded_amount
    ) part
WHERE part.gross_amount - part.refunded_amount < 0;
