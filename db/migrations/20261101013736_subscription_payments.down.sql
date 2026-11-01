DROP VIEW royalty_uncarried_subscription_episode_refunds;
DROP VIEW royalty_uncarried_subscription_refunds;
DROP TABLE royalty_statement_subscription_parts;
DROP TABLE royalty_statement_subscription_payments;

ALTER TABLE ONLY royalty_statement_lines
    DROP CONSTRAINT royalty_statement_lines_source_check;

-- The immutability trigger only refuses an UPDATE or a DELETE of a row, so
-- dropping the column passes it.
ALTER TABLE ONLY royalty_statement_lines
    DROP COLUMN source;

DROP VIEW subscription_payment_episode_parts;
DROP VIEW subscription_payment_completions;
DROP VIEW subscription_plan_episodes;
DROP TABLE subscription_payments;

-- Detaching the constraint drops its index along with it, and the previous
-- migration's down expects to find that index still there.
ALTER TABLE ONLY subscriptions
    DROP CONSTRAINT IF EXISTS subscriptions_tenant_id_id_key;

CREATE UNIQUE INDEX subscriptions_tenant_id_id_key ON subscriptions USING btree (tenant_id, id);
