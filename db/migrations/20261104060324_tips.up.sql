-- Tips: a reader gives the Authors of an episode one of the amounts the tenant
-- offers, through its payment provider or as a store's consumable product. A
-- tip is a purchase of its own kind, so the purchase history, refunds,
-- revenue, and royalty statements read it where they read a sale, and it
-- opens nothing.
--
-- The CHECK constraints on purchases, store_purchase_intents, and
-- royalty_statement_lines are added NOT VALID so this file takes its ACCESS
-- EXCLUSIVE locks without scanning those tables; the next migration validates
-- them under a lock that lets reads and writes continue.

-- COLUMN: purchases kind
-- `tip` is a payment to the Authors of the episode it names, which buys no
-- reading of it: it never expires, since there is nothing to expire, and it
-- names an episode, since its Authors are who it is for.
ALTER TABLE ONLY purchases
    DROP CONSTRAINT purchases_kind_check,
    ADD CONSTRAINT purchases_kind_check CHECK ((kind = ANY (ARRAY['rental'::text, 'purchase'::text, 'tip'::text]))) NOT VALID,
    ADD CONSTRAINT purchases_tip_check CHECK (((kind <> 'tip'::text) OR ((episode_id IS NOT NULL) AND (expires_at IS NULL)))) NOT VALID;

-- VIEW: episode_grants
-- A tip opens nothing, so the purchases of an episode leave it out. Every
-- query that decides access reads this view, reader_may_open_episode
-- included, and the release before reads it too, so its processes open no
-- episode to a reader for a tip either.
CREATE OR REPLACE VIEW episode_grants WITH (security_invoker = true) AS
SELECT at.tenant_id,
    at.user_id,
    at.episode_id,
    'access_ticket'::text AS kind,
    NULL::text AS purchase_kind
FROM access_tickets at
WHERE at.revoked_at IS NULL
    AND (
        at.expires_at IS NULL
        OR at.expires_at > NOW()
    )
UNION ALL
SELECT p.tenant_id,
    p.user_id,
    p.episode_id,
    'purchase'::text AS kind,
    p.kind AS purchase_kind
FROM purchases p
WHERE p.episode_id IS NOT NULL
    AND p.kind <> 'tip'
    AND p.revoked_at IS NULL
    AND (
        p.expires_at IS NULL
        OR p.expires_at > NOW()
    )
UNION ALL
SELECT p.tenant_id,
    p.user_id,
    ve.episode_id,
    'purchase'::text AS kind,
    p.kind AS purchase_kind
FROM purchases p
    JOIN volume_episodes ve ON ve.tenant_id = p.tenant_id
    AND ve.volume_id = p.volume_id
WHERE p.revoked_at IS NULL
    AND (
        p.expires_at IS NULL
        OR p.expires_at > NOW()
    )
UNION ALL
SELECT p.tenant_id,
    p.user_id,
    sbe.episode_id,
    'purchase'::text AS kind,
    p.kind AS purchase_kind
FROM purchases p
    JOIN series_bundle_episodes sbe ON sbe.tenant_id = p.tenant_id
    AND sbe.series_bundle_id = p.series_bundle_id
WHERE p.revoked_at IS NULL
    AND (
        sbe.reading_period_hours IS NULL
        OR p.purchased_at + make_interval(hours => sbe.reading_period_hours) > NOW()
    )
UNION ALL
SELECT ec.tenant_id,
    ca.user_id,
    ec.episode_id,
    'creator'::text AS kind,
    NULL::text AS purchase_kind
FROM episode_creators ec
    JOIN creator_accounts ca ON ca.tenant_id = ec.tenant_id
    AND ca.creator_id = ec.creator_id
UNION ALL
SELECT tur.tenant_id,
    tur.user_id,
    e.id AS episode_id,
    'staff'::text AS kind,
    NULL::text AS purchase_kind
FROM tenant_user_roles tur
    JOIN episodes e ON e.tenant_id = tur.tenant_id
WHERE tur.role IN ('tenant_admin', 'tenant_editor', 'tenant_auditor')

UNION ALL
SELECT s.tenant_id,
    s.user_id,
    e.id AS episode_id,
    'subscription'::text AS kind,
    NULL::text AS purchase_kind
FROM subscriptions s
    JOIN subscription_plans sp ON sp.tenant_id = s.tenant_id
    AND sp.id = s.plan_id
    JOIN episodes e ON e.tenant_id = s.tenant_id
    JOIN series sr ON sr.tenant_id = e.tenant_id
    AND sr.id = e.series_id
WHERE s.status IN ('trialing', 'active', 'past_due')
    AND s.current_period_end > NOW()
    AND (
        sp.scope = 'all'
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
        )
    );

-- COLUMN: store_purchase_intents kind
-- What the intent is to buy with the episode it names: `purchase`, the
-- permanent copy, which every intent opened before this column was, or `tip`,
-- a tip to its Authors at price, which opens nothing and so has no reading
-- period.
ALTER TABLE ONLY store_purchase_intents
    ADD COLUMN kind text DEFAULT 'purchase'::text NOT NULL,
    ADD CONSTRAINT store_purchase_intents_kind_check CHECK (((kind = ANY (ARRAY['purchase'::text, 'tip'::text])) AND ((kind <> 'tip'::text) OR ((episode_id IS NOT NULL) AND (reading_period_hours IS NULL))))) NOT VALID;

-- COLUMN: royalty_statement_lines source
-- `tip` is a line of the tips given to the Authors of an episode, apart from
-- the line of its sales under the same credit.
ALTER TABLE ONLY royalty_statement_lines
    DROP CONSTRAINT royalty_statement_lines_source_check,
    ADD CONSTRAINT royalty_statement_lines_source_check CHECK ((source = ANY (ARRAY['sale'::text, 'subscription'::text, 'tip'::text]))) NOT VALID;

-- COLUMN: tenant_config tips_enabled, tip_amounts
-- Whether the tenant takes tips, and the amounts a reader may give, in the
-- minor unit of the tenant currency: one to six of them, each above 0, which
-- the server writes in ascending order without repeats. Empty is none chosen
-- yet, which is what every tenant starts with, and tips cannot be on without
-- an amount to give. One row per tenant is small enough to check at once.
ALTER TABLE ONLY tenant_config
    ADD COLUMN tips_enabled boolean DEFAULT false NOT NULL,
    ADD COLUMN tip_amounts integer[] DEFAULT '{}'::integer[] NOT NULL,
    ADD CONSTRAINT tenant_config_tip_amounts_check CHECK (((cardinality(tip_amounts) <= 6) AND (array_position(tip_amounts, NULL::integer) IS NULL) AND (0 < ALL (tip_amounts)))),
    ADD CONSTRAINT tenant_config_tips_enabled_check CHECK (((NOT tips_enabled) OR (cardinality(tip_amounts) >= 1)));
