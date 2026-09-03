-- Let a reader be deleted while the purchases they made stay behind.
--
-- purchases_tenant_user_id_fkey was ON DELETE RESTRICT, so deleting a reader
-- who had bought an episode failed outright. A purchase is a commerce record
-- rather than an entitlement: content_daily_stats recomputes purchase_count
-- straight from this table and replaces the whole day, so cascading a buyer's
-- rows away would quietly lower a past day's revenue figures.
--
-- The row therefore keeps its tenant, episode, price and time, and loses only
-- the buyer. SET NULL names user_id explicitly so the reference can stay
-- composite: without the column list the action would null tenant_id as well,
-- and the row would lose the tenant the stats group by and the isolation
-- policy filters on. Every read pairs tenant_id with user_id, so a NULL buyer
-- matches no reader and the purchase leaves the library it belonged to.

ALTER TABLE purchases
    ALTER COLUMN user_id DROP NOT NULL;

-- FK CONSTRAINT: purchases purchases_tenant_user_id_fkey
ALTER TABLE ONLY purchases
    DROP CONSTRAINT purchases_tenant_user_id_fkey;

ALTER TABLE ONLY purchases
    ADD CONSTRAINT purchases_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE SET NULL (user_id);
