-- A refund recorded after its sale's month was closed is carried into the next
-- statement closed after it, as an adjustment line that takes back what the
-- refunded part of the sale paid. A closed month itself is never recomputed.
--
-- A statement line adds up many purchases, and purchases.refunded_amount is a
-- running total with no date on it, so neither says which part of a refund an
-- earlier close already took into account. Each close therefore writes down,
-- purchase by purchase, what it counted.

-- TABLE: royalty_statement_purchases
-- What one statement counted of one purchase. The month a purchase was sold in
-- counts it as a sale: sale_count 1, its price, and the part refunded by then.
-- A statement closed later that carries a refund of it counts the change
-- instead: 0 and the refund's growth while it stays a sale, -1 and the
-- negation of what was counted before once it is refunded in full, which is
-- when it stops being one. The rows of a purchase therefore add up to what the
-- statements have counted of it so far, and what is still to be carried is
-- that sum's distance from the purchase as it stands now.
CREATE TABLE royalty_statement_purchases (
    tenant_id uuid NOT NULL,
    -- No foreign key: the row is part of a closed statement and keeps the ID
    -- it counted, as a statement line keeps its catalog IDs. Nothing deletes
    -- a purchase but its tenant, which takes the statement along.
    purchase_id uuid NOT NULL,
    statement_id uuid NOT NULL,
    sale_count integer NOT NULL,
    gross_amount integer NOT NULL,
    refunded_amount integer NOT NULL,
    CONSTRAINT royalty_statement_purchases_sale_count_check CHECK (((sale_count >= '-1'::integer) AND (sale_count <= 1)))
);

-- CONSTRAINT: royalty_statement_purchases royalty_statement_purchases_pkey
-- Led by the purchase, which is how a close looks up what came before it.
ALTER TABLE ONLY royalty_statement_purchases
    ADD CONSTRAINT royalty_statement_purchases_pkey PRIMARY KEY (tenant_id, purchase_id, statement_id);

-- INDEX: idx_royalty_statement_purchases_statement_id
-- Serves the cascade from a deleted statement, which goes with its tenant.
CREATE INDEX idx_royalty_statement_purchases_statement_id ON royalty_statement_purchases USING btree (statement_id);

-- FK CONSTRAINT: royalty_statement_purchases royalty_statement_purchases_tenant_statement_id_fkey
ALTER TABLE ONLY royalty_statement_purchases
    ADD CONSTRAINT royalty_statement_purchases_tenant_statement_id_fkey FOREIGN KEY (tenant_id, statement_id) REFERENCES royalty_statements(tenant_id, id) ON DELETE CASCADE;

-- ROW SECURITY: royalty_statement_purchases
ALTER TABLE royalty_statement_purchases ENABLE ROW LEVEL SECURITY;

-- POLICY: royalty_statement_purchases royalty_statement_purchases_tenant_isolation
CREATE POLICY royalty_statement_purchases_tenant_isolation ON royalty_statement_purchases USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TRIGGER: royalty_statement_purchases royalty_statement_purchases_immutable
-- Part of the statement it was written with, and as unchangeable.
CREATE TRIGGER royalty_statement_purchases_immutable
    BEFORE UPDATE OR DELETE ON royalty_statement_purchases
    FOR EACH ROW
    EXECUTE FUNCTION royalty_statements_refuse_changes();

-- A statement closed before this table existed recorded nothing of its
-- purchases, so they are written down as its own sales the way they stand now.
-- A refund that arrived between such a close and this migration cannot be
-- told from one that came before the close, and is taken as counted: it stays
-- uncarried, as it was before this migration. A refund recorded from here on
-- is carried.
INSERT INTO royalty_statement_purchases (tenant_id, purchase_id, statement_id, sale_count, gross_amount, refunded_amount)
SELECT
    rs.tenant_id,
    p.id,
    rs.id,
    1,
    p.price_at_purchase,
    COALESCE(p.refunded_amount, 0)
FROM royalty_statements rs
JOIN purchases p ON p.tenant_id = rs.tenant_id
    AND p.purchased_at >= rs.starts_at
    AND p.purchased_at < rs.ends_at
WHERE p.refunded_at IS NULL
    AND NOT p.is_test
    AND p.currency = rs.currency;

-- COLUMN: royalty_statement_lines adjusted_statement_id
-- COLUMN: royalty_statement_lines adjusted_line_number
-- Both NULL for a line of the month's own sales. Otherwise the line is an
-- adjustment of that line of an earlier statement: it carries the refunds
-- recorded since on the sales the line counted, under the line's creator,
-- episode, role, names, and share. Its figures are changes, so they are zero
-- or negative where a line of sales has them positive: sale_count is minus the
-- sales refunded in full, gross_amount minus their price, and refunded_amount
-- the change in what is refunded of the sales counted.
--
-- Its payout is what the refunds take off the adjusted line: that line's
-- payout recomputed, floored the same way, over its net after them, less the
-- same over its net before them, its earlier adjustments included. The line
-- and its adjustments therefore always add up to what the line would pay had
-- the refunds come before its close, which is nothing once every sale in it is
-- refunded, however the refunds were spread over later months. That is why an
-- adjustment's payout cannot be recomputed from the adjustment alone, as a
-- line of sales can.
ALTER TABLE ONLY royalty_statement_lines
    ADD COLUMN adjusted_statement_id uuid,
    ADD COLUMN adjusted_line_number integer;

-- CONSTRAINT: royalty_statement_lines royalty_statement_lines_tenant_id_statement_id_line_number_key
-- The target of an adjustment's reference, which names the tenant as every
-- reference to a tenant-scoped row does.
ALTER TABLE ONLY royalty_statement_lines
    ADD CONSTRAINT royalty_statement_lines_tenant_id_statement_id_line_number_key UNIQUE (tenant_id, statement_id, line_number);

-- FK CONSTRAINT: royalty_statement_lines royalty_statement_lines_tenant_adjusted_line_fkey
ALTER TABLE ONLY royalty_statement_lines
    ADD CONSTRAINT royalty_statement_lines_tenant_adjusted_line_fkey FOREIGN KEY (tenant_id, adjusted_statement_id, adjusted_line_number) REFERENCES royalty_statement_lines(tenant_id, statement_id, line_number);

-- INDEX: idx_royalty_statement_lines_adjusted_line
-- Finds the adjustments a line has had, which the next one is computed from.
CREATE INDEX idx_royalty_statement_lines_adjusted_line ON royalty_statement_lines USING btree (tenant_id, adjusted_statement_id, adjusted_line_number) WHERE (adjusted_statement_id IS NOT NULL);

-- CONSTRAINT: royalty_statement_lines royalty_statement_lines_amounts_check
ALTER TABLE ONLY royalty_statement_lines
    DROP CONSTRAINT royalty_statement_lines_amounts_check;
ALTER TABLE ONLY royalty_statement_lines
    ADD CONSTRAINT royalty_statement_lines_amounts_check CHECK ((((adjusted_statement_id IS NULL) AND (adjusted_line_number IS NULL) AND (sale_count > 0) AND (refunded_amount >= 0) AND (gross_amount >= refunded_amount)) OR ((adjusted_statement_id IS NOT NULL) AND (adjusted_line_number IS NOT NULL) AND (sale_count <= 0) AND (gross_amount <= 0) AND (gross_amount < refunded_amount))));

-- CONSTRAINT: royalty_statement_lines royalty_statement_lines_payout_check
ALTER TABLE ONLY royalty_statement_lines
    DROP CONSTRAINT royalty_statement_lines_payout_check;
ALTER TABLE ONLY royalty_statement_lines
    ADD CONSTRAINT royalty_statement_lines_payout_check CHECK ((((adjusted_statement_id IS NULL) AND (payout_amount = (((gross_amount - refunded_amount) * share_bps) / 10000))) OR ((adjusted_statement_id IS NOT NULL) AND (payout_amount <= 0))));

-- COLUMN: royalty_statements total_adjustment
-- The net sales of earlier statements that the statement's adjustment lines
-- take back, each refunded sale counted once however many creators it is
-- credited to: zero, or a negative amount. No statement closed before this
-- column carried an adjustment.
ALTER TABLE ONLY royalty_statements
    ADD COLUMN total_adjustment bigint DEFAULT 0 NOT NULL;
ALTER TABLE ONLY royalty_statements
    ALTER COLUMN total_adjustment DROP DEFAULT;

-- CONSTRAINT: royalty_statements royalty_statements_amounts_check
-- total_payout includes the adjustment lines, so a month whose refunds of
-- earlier sales outweigh its own sales pays out a negative amount.
ALTER TABLE ONLY royalty_statements
    DROP CONSTRAINT royalty_statements_amounts_check;
ALTER TABLE ONLY royalty_statements
    ADD CONSTRAINT royalty_statements_amounts_check CHECK (((total_gross >= 0) AND (total_refunded >= 0) AND (total_adjustment <= 0)));

-- VIEW: royalty_uncarried_refunds
-- Each purchase a statement has counted whose net, its price less its refund,
-- has fallen since, with the change still to be carried and the statement of
-- the month it was sold in. A purchase counts as a sale while it is not
-- refunded in full, the rule the month's own lines apply. A close carries the
-- rows of statements of earlier months than its own, and a preview shows the
-- same rows, so the two cannot disagree.
--
-- Only a purchase with a refund on it can have a row, which is what keeps a
-- close from summing every purchase the tenant ever sold.
CREATE VIEW royalty_uncarried_refunds WITH (security_invoker = true) AS
SELECT
    p.tenant_id,
    p.id AS purchase_id,
    p.episode_id,
    p.currency,
    rs.id AS statement_id,
    rs.period,
    (cur.sale_count - counted.sale_count)::integer AS sale_count,
    (cur.gross_amount - counted.gross_amount)::bigint AS gross_amount,
    (cur.refunded_amount - counted.refunded_amount)::bigint AS refunded_amount
FROM purchases p
JOIN royalty_statements rs ON rs.tenant_id = p.tenant_id
    AND p.purchased_at >= rs.starts_at
    AND p.purchased_at < rs.ends_at
CROSS JOIN LATERAL (
    SELECT
        sum(rsp.sale_count) AS sale_count,
        sum(rsp.gross_amount) AS gross_amount,
        sum(rsp.refunded_amount) AS refunded_amount
    FROM royalty_statement_purchases rsp
    WHERE rsp.tenant_id = p.tenant_id
        AND rsp.purchase_id = p.id
) counted
CROSS JOIN LATERAL (
    SELECT
        CASE WHEN p.refunded_at IS NULL THEN 1 ELSE 0 END AS sale_count,
        CASE WHEN p.refunded_at IS NULL THEN p.price_at_purchase ELSE 0 END AS gross_amount,
        CASE WHEN p.refunded_at IS NULL THEN COALESCE(p.refunded_amount, 0) ELSE 0 END AS refunded_amount
) cur
WHERE p.refunded_amount IS NOT NULL
    AND counted.sale_count IS NOT NULL
    AND cur.gross_amount - cur.refunded_amount < counted.gross_amount - counted.refunded_amount;
