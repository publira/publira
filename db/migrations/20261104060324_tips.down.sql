ALTER TABLE ONLY tenant_config
    DROP CONSTRAINT tenant_config_tips_enabled_check,
    DROP CONSTRAINT tenant_config_tip_amounts_check,
    DROP COLUMN tip_amounts,
    DROP COLUMN tips_enabled;

-- The schema this restores has no tip, so none is left behind in it. A closed
-- statement loses its tip lines, and its totals what its tips counted for in
-- them, which royalty_statement_purchases recorded per purchase: a tip of the
-- statement's own month in its gross and its refunds (sale_count 1), and a
-- tip refunded after an earlier close in its adjustment. Its payout, its tax,
-- each Author's subtotal, and what the subtotals withhold are put back to
-- what the lines it keeps add up to, as the close works them out. The
-- immutability triggers refuse all of it, so they are set aside around it, as
-- the down migration of royalty_refund_adjustments does.
ALTER TABLE royalty_statement_lines DISABLE TRIGGER royalty_statement_lines_immutable;
ALTER TABLE royalty_statements DISABLE TRIGGER royalty_statements_immutable;
ALTER TABLE royalty_statement_purchases DISABLE TRIGGER royalty_statement_purchases_immutable;
ALTER TABLE royalty_statement_creator_subtotals DISABLE TRIGGER royalty_statement_creator_subtotals_immutable;

CREATE TEMPORARY TABLE tipped_statements ON COMMIT DROP AS
SELECT s.tenant_id,
    s.statement_id,
    COALESCE(sum(tip.gross_amount) FILTER (WHERE tip.sale_count = 1), 0)::bigint AS gross,
    COALESCE(sum(tip.refunded_amount) FILTER (WHERE tip.sale_count = 1), 0)::bigint AS refunded,
    COALESCE(sum(tip.gross_amount - tip.refunded_amount) FILTER (WHERE tip.sale_count < 1), 0)::bigint AS adjustment
FROM (
    SELECT l.tenant_id, l.statement_id
    FROM royalty_statement_lines l
    WHERE l.source = 'tip'
    UNION
    SELECT rsp.tenant_id, rsp.statement_id
    FROM royalty_statement_purchases rsp
        JOIN purchases p ON p.tenant_id = rsp.tenant_id
        AND p.id = rsp.purchase_id
    WHERE p.kind = 'tip'
) s
    LEFT JOIN LATERAL (
        SELECT rsp.sale_count, rsp.gross_amount, rsp.refunded_amount
        FROM royalty_statement_purchases rsp
            JOIN purchases p ON p.tenant_id = rsp.tenant_id
            AND p.id = rsp.purchase_id
        WHERE rsp.tenant_id = s.tenant_id
            AND rsp.statement_id = s.statement_id
            AND p.kind = 'tip'
    ) tip ON true
GROUP BY s.tenant_id, s.statement_id;

DELETE FROM royalty_statement_lines
WHERE source = 'tip';

DELETE FROM royalty_statement_creator_subtotals st
USING tipped_statements t
WHERE st.tenant_id = t.tenant_id
    AND st.statement_id = t.statement_id
    AND NOT EXISTS (
        SELECT 1
        FROM royalty_statement_lines l
        WHERE l.tenant_id = st.tenant_id
            AND l.statement_id = st.statement_id
            AND l.creator_id IS NOT DISTINCT FROM st.creator_id
    );

UPDATE royalty_statement_creator_subtotals st
SET payout_amount = kept.payout,
    tax_amount = kept.tax,
    withholding_amount = CASE
        WHEN rs.withholding_rate_bps IS NULL THEN NULL
        WHEN kept.payout - COALESCE(kept.tax, 0) <= 0 THEN 0
        ELSE (kept.payout - COALESCE(kept.tax, 0)) * rs.withholding_rate_bps / 10000
    END
FROM tipped_statements t
    JOIN royalty_statements rs ON rs.tenant_id = t.tenant_id
    AND rs.id = t.statement_id
    JOIN (
        SELECT l.tenant_id,
            l.statement_id,
            l.creator_id,
            sum(l.payout_amount)::bigint AS payout,
            sum(l.tax_amount)::bigint AS tax
        FROM royalty_statement_lines l
        GROUP BY l.tenant_id, l.statement_id, l.creator_id
    ) kept ON kept.tenant_id = t.tenant_id
    AND kept.statement_id = t.statement_id
WHERE st.tenant_id = t.tenant_id
    AND st.statement_id = t.statement_id
    AND st.creator_id IS NOT DISTINCT FROM kept.creator_id;

UPDATE royalty_statements rs
SET total_gross = rs.total_gross - t.gross,
    total_refunded = rs.total_refunded - t.refunded,
    total_adjustment = rs.total_adjustment - t.adjustment,
    total_payout = COALESCE((
        SELECT sum(l.payout_amount)
        FROM royalty_statement_lines l
        WHERE l.tenant_id = rs.tenant_id
            AND l.statement_id = rs.id
    ), 0),
    total_tax = (
        SELECT sum(l.tax_amount)
        FROM royalty_statement_lines l
        WHERE l.tenant_id = rs.tenant_id
            AND l.statement_id = rs.id
    ),
    total_withholding = CASE
        WHEN rs.withholding_rate_bps IS NULL THEN NULL
        ELSE COALESCE((
            SELECT sum(st.withholding_amount)
            FROM royalty_statement_creator_subtotals st
            WHERE st.tenant_id = rs.tenant_id
                AND st.statement_id = rs.id
        ), 0)
    END
FROM tipped_statements t
WHERE rs.tenant_id = t.tenant_id
    AND rs.id = t.statement_id;

DELETE FROM royalty_statement_purchases rsp
USING purchases p
WHERE p.tenant_id = rsp.tenant_id
    AND p.id = rsp.purchase_id
    AND p.kind = 'tip';

ALTER TABLE royalty_statement_creator_subtotals ENABLE TRIGGER royalty_statement_creator_subtotals_immutable;
ALTER TABLE royalty_statement_purchases ENABLE TRIGGER royalty_statement_purchases_immutable;
ALTER TABLE royalty_statements ENABLE TRIGGER royalty_statements_immutable;
ALTER TABLE royalty_statement_lines ENABLE TRIGGER royalty_statement_lines_immutable;

ALTER TABLE ONLY royalty_statement_lines
    DROP CONSTRAINT royalty_statement_lines_source_check,
    ADD CONSTRAINT royalty_statement_lines_source_check CHECK ((source = ANY (ARRAY['sale'::text, 'subscription'::text])));

DELETE FROM store_purchase_intents
WHERE kind = 'tip';

ALTER TABLE ONLY store_purchase_intents
    DROP CONSTRAINT store_purchase_intents_kind_check,
    DROP COLUMN kind;

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

DELETE FROM purchases
WHERE kind = 'tip';

ALTER TABLE ONLY purchases
    DROP CONSTRAINT purchases_tip_check,
    DROP CONSTRAINT purchases_kind_check,
    ADD CONSTRAINT purchases_kind_check CHECK ((kind = ANY (ARRAY['rental'::text, 'purchase'::text])));
