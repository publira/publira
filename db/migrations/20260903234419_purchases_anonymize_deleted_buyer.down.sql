-- Restore the buyer as a required, RESTRICT-ed reference.
--
-- A purchase whose buyer was already anonymized names no user, so it cannot
-- satisfy the restored NOT NULL and is dropped first.
DELETE FROM purchases
WHERE user_id IS NULL;

ALTER TABLE ONLY purchases
    DROP CONSTRAINT purchases_tenant_user_id_fkey;

ALTER TABLE purchases
    ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE ONLY purchases
    ADD CONSTRAINT purchases_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE RESTRICT;
